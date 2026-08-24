const fs = require('fs');
const path = require('path');

function walkDir(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walkDir(file));
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            results.push(file);
        }
    });
    return results;
}

const files = walkDir('src');
let count = 0;
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('Ã')) {
    console.log('Fixing', file);
    count++;
    
    // Auto-fix common patterns based on dictionary
    const replacements = {
      'Ã¡': 'á', 'Ã©': 'é', 'Ã­': 'í', 'Ã³': 'ó', 'Ãº': 'ú', 'Ã±': 'ñ',
      'Ã\x81': 'Á', 'Ã\x89': 'É', 'Ã\x8D': 'Í', 'Ã\x93': 'Ó', 'Ã\x9A': 'Ú', 'Ã\x91': 'Ñ',
      'RepeticiÃ³n': 'Repetición',
      'ConfiguraciÃ³n': 'Configuración',
      'PequeÃ±a': 'Pequeña',
      'botÃ³n': 'botón',
      'mÃ³vil': 'móvil',
      'MÃ¡s': 'Más',
      'AdministraciÃ³n': 'Administración',
      'sesiÃ³n': 'sesión',
      'Ãšltima': 'Última',
      'seÃ±al': 'señal',
      'DirecciÃ³n': 'Dirección',
      'acciÃ³n': 'acción'
    };
    
    for (const [bad, good] of Object.entries(replacements)) {
      content = content.split(bad).join(good);
    }
    fs.writeFileSync(file, content, 'utf8');
  }
}
console.log('Fixed', count, 'files');
