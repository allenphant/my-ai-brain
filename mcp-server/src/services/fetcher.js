import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import dns from 'node:dns/promises';

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '169.254.169.254']);

export function isPrivateIp(ip) {
  if (BLOCKED_HOSTS.has(ip)) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  return false;
}

export function isPrivateIpOrBlockedHost(hostname) {
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) return true;
  return isPrivateIp(hostname);
}

export async function validateSafeUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Invalid protocol ${parsed.protocol}. Only http and https are allowed.`);
  }

  const hostname = parsed.hostname;
  if (isPrivateIpOrBlockedHost(hostname)) {
    throw new Error(`SSRF protection: access to ${hostname} is blocked.`);
  }

  try {
    const lookup = await dns.lookup(hostname);
    if (isPrivateIp(lookup.address)) {
      throw new Error(`SSRF protection: resolved IP ${lookup.address} is private.`);
    }
  } catch (err) {
    if (err.message.includes('SSRF protection')) throw err;
  }

  return parsed.toString();
}

export async function readUrlContent(rawUrl, maxLength = 3000) {
  const safeUrl = await validateSafeUrl(rawUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(safeUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url: safeUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.trim().length < 50) {
      return {
        url: safeUrl,
        title: dom.window.document.title || 'No title',
        excerpt: '',
        contentMarkdown: article?.textContent?.trim() || '',
        isProbablySPA: true
      };
    }

    const truncatedContent = article.textContent.trim().slice(0, maxLength);
    return {
      url: safeUrl,
      title: article.title || dom.window.document.title || 'Untitled',
      excerpt: article.excerpt || '',
      contentMarkdown: truncatedContent,
      isProbablySPA: truncatedContent.length < 100
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
