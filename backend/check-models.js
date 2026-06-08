require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function checkModels() {
  try {
    console.log('?? API Key:', process.env.GEMINI_API_KEY ? 'exists' : 'missing');
    console.log('?? Checking available models...');
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // ������� ������ ������ ������� ����� ��������
    const models = [
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-pro',
      'gemini-pro-vision'
    ];
    
    for (const modelName of models) {
      try {
        console.log(`?? Testing ${modelName}...`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent('Hi');
        const response = await result.response;
        console.log(`? ${modelName} works!`);
        break;
      } catch (err) {
        console.log(`? ${modelName} failed: ${err.message}`);
      }
    }
  } catch (error) {
    console.error('? General error:', error.message);
  }
}

checkModels();
