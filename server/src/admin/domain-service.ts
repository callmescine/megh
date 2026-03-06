import dns from 'dns';
import { promisify } from 'util';

const resolveTxt = promisify(dns.resolveTxt);

export async function verifyDomain(domain: string, expectedToken: string): Promise<boolean> {
  try {
    const records = await resolveTxt(`_megh-verify.${domain}`);
    // records is an array of arrays of strings
    for (const record of records) {
      const value = record.join('');
      if (value === expectedToken) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function generateNginxConfig(domain: string): string {
  return `# Megh custom domain: ${domain}
server {
    listen 443 ssl;
    server_name ${domain};

    ssl_certificate /etc/ssl/certs/${domain}.crt;
    ssl_certificate_key /etc/ssl/private/${domain}.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    location /api/ {
        proxy_pass http://api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://web;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    client_max_body_size 200M;
}
`;
}
