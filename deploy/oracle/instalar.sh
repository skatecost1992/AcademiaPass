#!/usr/bin/env bash
# Instala AcademiaPass en una maquina virtual Ubuntu (Oracle Cloud Always Free, ARM o x86). Ejecutar UNA vez:
#   git clone https://github.com/skatecost1992/AcademiaPass.git && cd AcademiaPass/deploy/oracle
#   cp .env.example .env && nano .env        # completar DOMAIN, DATABASE_URL, RESEND_API_KEY, MAIL_FROM
#   bash instalar.sh
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Falta .env: cp .env.example .env y completalo"; exit 1; }
grep -q '^DOMAIN=.\+' .env || { echo "Completa DOMAIN en .env"; exit 1; }
grep -q '^DATABASE_URL=.\+' .env || { echo "Completa DATABASE_URL en .env"; exit 1; }
if ! grep -q '^JWT_SECRET=.\+' .env; then
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
  echo "JWT_SECRET generado"
fi
chmod 600 .env

# 1. Docker
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# 2. Firewall interno de las imagenes Ubuntu de Oracle: abre 80 y 443 (ademas de la Security List de la VCN)
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport "$port" -j ACCEPT
done
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null
sudo netfilter-persistent save

# 3. Memoria de intercambio para compilar la version web en maquinas pequenas
if ! swapon --show | grep -q .; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# 4. Compilar y arrancar (se reinicia solo al reiniciar la maquina: restart unless-stopped)
sudo docker compose up -d --build
sudo systemctl enable docker >/dev/null

DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
echo "Listo. Revisa https://$DOMAIN/api/health (el certificado puede tardar 1 minuto)."
echo "Registro: sudo docker compose logs -f api"
