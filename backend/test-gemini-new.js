require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
  try {
    console.log('?? API Key:', process.env.GEMINI_API_KEY ? 'exists' : 'missing');
    console.log('?? Testing Gemini API...');
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // ������� gemini-2.5-flash - ��������� ������
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    console.log('?? Sending test message...');
    const result = await model.generateContent('������! �������� � ���� � 2 ������������.');
    const response = await result.response;
    const text = response.text();
    
    console.log('? Gemini ��������!');
    console.log('?? �����:', text);
  } catch (error) {
    console.error('? ������ Gemini:', error.message);
    
    if (error.message.includes('404')) {
      console.log('?? ��������� �������:');
      console.log('   1. ������� ��� API ���� ���������� (������ ����� �� https://makersuite.google.com/app/apikey)');
      console.log('   2. ������� ��� Gemini API �������� � ����� �������');
      console.log('   3. �������� ������ gemini-pro ������ gemini-1.5-flash');
    }
  }
}

testGemini();
