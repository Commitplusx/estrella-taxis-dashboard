const fs = require('fs');

function fixDoubleEncoding(file) {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('Ã')) {
    // Some characters might just be normal UTF-8. 
    // We only want to convert if the file actually contains double-encoded mojibake.
    // The easiest way is to convert the whole file from 'binary' to 'utf8', BUT
    // this assumes every character in the file is <= 255. 
    // If there are real UTF-8 characters (like emoji), 'binary' (latin1) will truncate their higher bits!
    // Instead of converting the whole file, let's just do a string replacement of known mojibake patterns.
    console.log('File has Ã:', file);
  }
}

fixDoubleEncoding('src/pages/ReportsPage.tsx');
