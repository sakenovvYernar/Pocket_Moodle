require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
  try {
    console.log('API Key:', process.env.GEMINI_API_KEY ? 'exists' : 'missing');
    console.log('Testing Gemini API...');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // �������� ������ �������
    console.log('��������� ������ �������...');
    // ������� ����� ������� ������
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
    
    const result = await model.generateContent('Hello');
    const response = await result.response;
    const text = response.text();
    
    console.log('? Gemini ��������!');
    console.log('�����:', text);
  } catch (error) {
    console.error('? ������ Gemini:', error.message);
    console.error('������ ������:', error);
  }
}

testGemini();
