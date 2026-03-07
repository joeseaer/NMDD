const fetch = require('node-fetch');

async function testCreate() {
    try {
        const response = await fetch('http://localhost:3000/api/sop/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: "Test Note Script",
                category: "note",
                content: "Testing from script",
                user_id: "user-1"
            })
        });
        
        console.log("Status:", response.status);
        const text = await response.text();
        console.log("Body:", text);
    } catch (e) {
        console.error("Error:", e);
    }
}

testCreate();