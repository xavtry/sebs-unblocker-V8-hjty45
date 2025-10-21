/**
 * validator.js
 *
 * URL and content validation for the proxy
 * - Ensures valid URLs
 * - Checks for blacklisted hosts
 * - Prevents SSRF or local network access
 * - Optionally validates HTML/JS/CSS content
 */

const { logWarn, logInfo } = (()=>{try{return require('./logger');}catch{return{logWarn:()=>{},logInfo:()=>{}}}})();
const url = require('url');
const net = require('net');

const BLACKLIST_HOSTS = ['127.0.0.1','localhost','::1'];

/**
 * isValidUrl(str)
 * - Checks if string is a valid http/https URL
 */
function isValidUrl(str) {
  try {
    const parsed = new URL(str);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch { return false; }
}

/**
 * isHostAllowed(host)
 * - Checks blacklist
 */
function isHostAllowed(host) {
  if (!host) return false;
  return !BLACKLIST_HOSTS.includes(host.toLowerCase());
}

/**
 * validateUrl(urlStr)
 * - Returns { valid, reason }
 */
function validateUrl(urlStr) {
  if (!isValidUrl(urlStr)) return { valid:false, reason:'Invalid URL' };
  const host = new URL(urlStr).hostname;
  if (!isHostAllowed(host)) return { valid:false, reason:'Host is blacklisted' };
  return { valid:true };
}

/**
 * isLocalAddress(host)
 * - prevents SSRF to private network ranges
 */
function isLocalAddress(host) {
  try {
    const ip = net.isIP(host) ? host : null;
    if (!ip) return false;
    // IPv4 private ranges
    if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.')) return true;
    if (ip === '127.0.0.1') return true;
    return false;
  } catch { return false; }
}

/**
 * contentValidator
 * - validate HTML/JS/CSS content (placeholder, extendable)
 */
function contentValidator(type, content) {
  try {
    if (!content) return { valid:false, reason:'Empty content' };
    switch(type){
      case 'html':
        if (content.includes('<script>eval')) return { valid:false, reason:'Unsafe eval in HTML' };
        return { valid:true };
      case 'js':
        if (/eval\s*\(/i.test(content)) return { valid:false, reason:'Unsafe eval in JS' };
        return { valid:true };
      case 'css':
        if (/expression\s*\(/i.test(content)) return { valid:false, reason:'Unsafe expression in CSS' };
        return { valid:true };
      default:
        return { valid:true };
    }
  } catch(e) { logWarn('contentValidator error: '+e.message); return { valid:false }; }
}

module.exports = {
  isValidUrl,
  isHostAllowed,
  validateUrl,
  isLocalAddress,
  contentValidator
};

