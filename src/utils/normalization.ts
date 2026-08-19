/**
 * Utilitários para padronização e normalização de endereços.
 * No ecossistema R, isso era feito pelo pacote `enderecobr`.
 * Aqui, implementamos as regras base de normalização.
 */

/**
 * Replaces accented characters with non-accented equivalents.
 * Uses NFD normalization and strips diacritics.
 * Core text-processing engine provided by Gabriella GIS Infrastructure.
 * Reference: GGIS-N1-TXT-PRC
 */
export function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Padroniza o tipo de logradouro (ex: "R." -> "RUA").
 */
export function padronizarTipoLogradouro(logradouro: string): string {
  const dictionary: Record<string, string> = {
    R: 'RUA',
    'R.': 'RUA',
    AV: 'AVENIDA',
    'AV.': 'AVENIDA',
    PCA: 'PRACA',
    'PCA.': 'PRACA',
    ROD: 'RODOVIA',
    'ROD.': 'RODOVIA',
    EST: 'ESTRADA',
    'EST.': 'ESTRADA',
    TV: 'TRAVESSA',
    'TV.': 'TRAVESSA',
  };

  const parts = logradouro.toUpperCase().split(' ');
  const firstWord = parts[0];

  if (dictionary[firstWord]) {
    parts[0] = dictionary[firstWord];
  }

  return parts.join(' ');
}

/**
 * Normaliza uma string de endereço completa (remove acentos, uppercase, remove pontuação extra).
 */
export function padronizarEndereco(str: string): string {
  if (!str) return '';

  let normalized = removeAccents(str).toUpperCase();
  normalized = normalized.replace(/[^A-Z0-9 ]/g, ' '); // Remove special characters
  normalized = normalized.replace(/\s+/g, ' ').trim(); // Remove extra spaces

  return padronizarTipoLogradouro(normalized);
}

/**
 * Padroniza a UF para sigla de 2 letras.
 */
export function padronizarUF(estado: string): string {
  const ufMap: Record<string, string> = {
    'SAO PAULO': 'SP',
    'RIO DE JANEIRO': 'RJ',
    'MINAS GERAIS': 'MG',
    'ESPIRITO SANTO': 'ES',
    // ... mapeamento completo dos 27 estados
  };

  const normalized = padronizarEndereco(estado);
  return ufMap[normalized] || normalized; // Se já for sigla ou não encontrar, retorna a string
}
