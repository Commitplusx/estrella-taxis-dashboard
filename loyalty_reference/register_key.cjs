const fs = require('fs');

const token = 'EAAhR4GDYGKEBRNoUp3xvQ8kxjbiZChVVeA0M2EkjuiHsSt50ZC1efDJiE5TdBQTJqT1PtC32EiS4f0jX6ZB3ZBGcE3UXc4RmhQlJK6QRkLtWvSGqgyS1XRWeMK5P54SyifaEhKlfcVGIMigcQQjZBbh2FKspTMw9Ne42a7rs4L4G9N89TiGtjtOtpEwGWQQZDZD';
const phoneIds = ['1155044321029650', '932763423246982'];

const publicKey = fs.readFileSync('flows_public.pem', 'utf8');
// Meta requires removing the header/footer and newlines for some APIs, but for this one, 
// usually you pass the raw string with \n. We'll pass the raw string.

async function uploadKey(phoneId) {
  const url = `https://graph.facebook.com/v19.0/${phoneId}/whatsapp_business_encryption`;
  
  const formData = new URLSearchParams();
  formData.append('business_public_key', publicKey);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });
    const result = await response.json();
    console.log(`Phone ${phoneId} result:`, result);
  } catch (err) {
    console.error(`Error on Phone ${phoneId}:`, err);
  }
}

async function run() {
  for (const id of phoneIds) {
    await uploadKey(id);
  }
}

run();
