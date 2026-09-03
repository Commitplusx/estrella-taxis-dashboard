let texto = 'aqui en la pilita'

let limpio = texto.toLowerCase().trim()
  .replace(/^(aqu[ií]|llev[aá]lo|ll[eé]valo|voy|quiero\s+ir|mandar|m[aá]ndalo|vamos)\s+/g, '')
  .replace(/^(a|en|para|por|rumbo\s+a|hasta|hacia)\s+/g, '')
  .replace(/^(la|el|los|las|de|del|un|una)\s+/g, '')
  .replace(/^(barrio|colonia|col|fracc|fraccionamiento|barrio\s+de\s+la)\s+/g, '')
  .replace(/^(la|el|los|las|de|del|un|una)\s+/g, '')
  .trim()

console.log(limpio)
