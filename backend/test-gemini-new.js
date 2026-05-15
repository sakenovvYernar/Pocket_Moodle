require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
  try {
    console.log('🔑 API Key:', process.env.GEMINI_API_KEY ? 'exists' : 'missing');
    console.log('🤖 Testing Gemini API...');
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Пробуем gemini-2.5-flash - последняя версия
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    console.log('📤 Sending test message...');
    const result = await model.generateContent('Привет! Расскажи о себе в 2 предложениях.');
    const response = await result.response;
    const text = response.text();
    
    console.log('✅ Gemini работает!');
    console.log('📝 Ответ:', text);
  } catch (error) {
    console.error('❌ Ошибка Gemini:', error.message);
    
    if (error.message.includes('404')) {
      console.log('💡 Возможные решения:');
      console.log('   1. Проверь что API ключ правильный (получи новый на https://makersuite.google.com/app/apikey)');
      console.log('   2. Убедись что Gemini API доступен в твоем регионе');
      console.log('   3. Попробуй модель gemini-pro вместо gemini-1.5-flash');
    }
  }
}

testGemini();
