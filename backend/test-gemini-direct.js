require('dotenv').config();
const https = require('https');

async function testDirectAPI() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log('🔑 Testing API key:', apiKey ? apiKey.substring(0, 20) + '...' : 'missing');
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('📡 Response status:', res.statusCode);
        if (res.statusCode === 200) {
          console.log('✅ API key valid!');
          console.log('📋 Available models:');
          const models = JSON.parse(data);
          models.models.forEach(model => {
            console.log(`  - ${model.name}: ${model.displayName}`);
          });
        } else {
          console.log('❌ API key invalid or error');
          console.log('Response:', data);
        }
        resolve();
      });
    }).on('error', reject);
  });
}

testDirectAPI();
