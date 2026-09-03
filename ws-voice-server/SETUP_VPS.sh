# ─── 1. Node.js 20 ───────────────────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# ─── 2. PM2 (proceso persistente) ────────────────────────────────────────────
sudo npm install -g pm2

# ─── 3. Crear carpeta del servidor ───────────────────────────────────────────
mkdir -p /var/www/pompeyo-ws
cd /var/www/pompeyo-ws

# Verificar versiones
node --version   # debe ser v20.x
pm2 --version

echo "✅ Listo para el siguiente paso"
