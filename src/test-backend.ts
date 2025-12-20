import { BACKEND_API_URL, BACKEND_API_KEY } from './constants';

// Simple test to verify backend connection
async function testBackendConnection() {
    console.log('🔍 Testing Backend Connection...');
    console.log('📍 Backend URL:', BACKEND_API_URL);
    console.log('🔑 API Key:', BACKEND_API_KEY ? '✅ Set' : '❌ Missing');

    try {
        const response = await fetch(`${BACKEND_API_URL}/health`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            console.log('✅ Backend Connected!', data);
            return { success: true, data };
        } else {
            console.error('❌ Backend Error:', response.status);
            return { success: false, error: `HTTP ${response.status}` };
        }
    } catch (error) {
        console.error('❌ Connection Failed:', error);
        return { success: false, error: error.message };
    }
}

// Run test immediately when imported
testBackendConnection();

export { testBackendConnection };
