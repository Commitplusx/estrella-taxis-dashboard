const fs = require('fs');
let content = fs.readFileSync('src/pages/ReportsPage.tsx', 'utf8');

const replacements = {
  'resÃºmenes': 'resúmenes',
  'PerÃ­odo:': 'Período:',
  '7 dÃ­as': '7 días',
  'DURACIÃ“N': 'DURACIÓN',
  'DIRECCIÃ“N': 'DIRECCIÓN',
  'PosiciÃ³n': 'Posición',
  'DirecciÃ³n': 'Dirección',
  'ConfiguraciÃ³n': 'Configuración',
  'Ã¡': 'á',
  'Ã©': 'é',
  'Ã­': 'í',
  'Ã³': 'ó',
  'Ãº': 'ú',
  'Ã±': 'ñ',
  'Ã\x81': 'Á', // Ã + \x81
  'Ã\x89': 'É',
  'Ã\x8D': 'Í',
  'Ã\x93': 'Ó',
  'Ã\x9A': 'Ú',
  'Ã\x91': 'Ñ'
};

for (const [bad, good] of Object.entries(replacements)) {
  content = content.split(bad).join(good);
}

fs.writeFileSync('src/pages/ReportsPage.tsx', content, 'utf8');
console.log('Fixed encoding in ReportsPage.tsx');
