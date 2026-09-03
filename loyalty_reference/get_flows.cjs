const token = 'EAAhR4GDYGKEBRNoUp3xvQ8kxjbiZChVVeA0M2EkjuiHsSt50ZC1efDJiE5TdBQTJqT1PtC32EiS4f0jX6ZB3ZBGcE3UXc4RmhQlJK6QRkLtWvSGqgyS1XRWeMK5P54SyifaEhKlfcVGIMigcQQjZBbh2FKspTMw9Ne42a7rs4L4G9N89TiGtjtOtpEwGWQQZDZD';
const wabaId = '1562946198083304';

async function getFlows() {
  const url = `https://graph.facebook.com/v19.0/${wabaId}/flows`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const result = await response.json();
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err);
  }
}

getFlows();
