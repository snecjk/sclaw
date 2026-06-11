// Auto proxy setup for Node.js fetch (undici)
// Loaded via NODE_OPTIONS=--import to make fetch() respect proxy env vars
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.all_proxy || process.env.ALL_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}
