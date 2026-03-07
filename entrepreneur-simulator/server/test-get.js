const fetch = require('node-fetch');

async function testGet() {
    try {
        const response = await fetch('http://localhost:3000/api/sop/user-1');
        console.log("Status:", response.status);
        const data = await response.json();
        console.log("Count:", data.length);
        if (data.length > 0) {
            console.log("First item:", data[0].title);
            // Check if our test note is there
            const testNote = data.find(n => n.title === "Test Note Script");
            console.log("Found Test Note:", !!testNote);
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

testGet();