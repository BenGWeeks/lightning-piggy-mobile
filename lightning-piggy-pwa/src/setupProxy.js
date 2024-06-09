const { createProxyMiddleware } = require('http-proxy-middleware');
const dotenv = require('dotenv');

// Be careful to have a single version installed, i.e. a mix of v2 in webpack and v3 can cause issues.

dotenv.config();

module.exports = function(app) {
  const target = process.env.REACT_APP_LNBITS_NODE_URL;
  //const apiKey = process.env.REACT_APP_LNBITS_API_KEY;

  console.log('setupProxy.js is being executed');
  console.log('API URL:', target);
  //console.log('API Key:', apiKey);
  //console.log(`Setting up proxy to ${target} with API key: ${apiKey}`);

  app.use(
    '/api/v1',
    createProxyMiddleware({
      target: target,
      changeOrigin: true,
      logLevel: 'debug',
      pathRewrite: { '^/api/v1': '/api/v1' },
      onProxyReq: (proxyReq, req, res) => {
        console.log(`Proxying request to: ${target}${req.url}`);
        //proxyReq.setHeader('X-Api-Key', apiKey);
        console.log('Request Headers:', JSON.stringify(proxyReq.getHeaders()));
      },
      onProxyRes: (proxyRes, req, res) => {
        console.log(`Proxy response from: ${target}${req.url}`);
        console.log('Response status code:', proxyRes.statusCode);
      },
      onError: (err, req, res) => {
        console.error('Proxy error:', err);
        console.log('Response body:', body);
      },
    })
  );

  app.use(
    '/lnurlp/api/v1',
    createProxyMiddleware({
      target: target,
      changeOrigin: true,
      logLevel: 'debug',
      pathRewrite: { '^/lnurlp/api/v1': '/lnurlp/api/v1' },
      onProxyReq: (proxyReq, req, res) => {
        console.log(`Proxying request to: ${target}${req.url}`);
        //proxyReq.setHeader('X-Api-Key', apiKey);
        console.log('Request Headers:', JSON.stringify(proxyReq.getHeaders()));
      },
      onProxyRes: (proxyRes, req, res) => {
        console.log(`Proxy response from: ${target}${req.url}`);
        console.log('Response status code:', proxyRes.statusCode);
      },
      onError: (err, req, res) => {
        console.error('Proxy error:', err);
        console.log('Response body:', body);
      },
    })
  );
};
