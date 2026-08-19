import { getDbConnection } from '../db/duckdb';

export type MatchType =
  | 'dn01'
  | 'dn02'
  | 'dn03'
  | 'dn04' // Deterministic matches
  | 'pb01'
  | 'pb02'
  | 'pb03'
  | 'pb04'; // Probabilistic matches

export interface MatchOptions {
  inputTable: string;
  outputTable: string;
  matchType: MatchType;
  keyCols: string[];
  resultadoCompleto?: boolean;
}

/**
 * Mapeia o tipo de match para a respectiva tabela parquet do CNEFE.
 */
function getReferenceTable(matchType: MatchType): string {
  switch (matchType) {
    case 'dn01':
    case 'pb01':
      return 'municipio_logradouro_numero_cep_localidade';
    case 'dn02':
    case 'pb02':
      return 'municipio_logradouro_numero_localidade';
    case 'dn03':
    case 'pb03':
      return 'municipio_logradouro_cep_localidade';
    case 'dn04':
    case 'pb04':
      return 'municipio_logradouro_localidade';
    default:
      throw new Error(`Unsupported match type: ${matchType}`);
  }
}

/**
 * Tradução da função match_cases do R para TypeScript
 * Executa um INNER JOIN determinístico para encontrar endereços e os insere na tabela de output.
 */
export async function matchCases(options: MatchOptions): Promise<void> {
  const db = await getDbConnection();
  const cnefeTable = getReferenceTable(options.matchType);
  const x = options.inputTable;
  const y = cnefeTable;

  // Monta a condição do JOIN
  const joinCondition = options.keyCols.map((col) => `${y}.${col} = ${x}.${col}`).join(' AND ');

  // Filtro de colunas não nulas para evitar false-positives em NULLs
  const colsNotNull = options.keyCols.map((col) => `${x}.${col} IS NOT NULL`).join(' AND ');

  let colunasEncontradas = '';
  let additionalCols = '';

  if (options.resultadoCompleto) {
    const cols = options.keyCols.map((c) =>
      c.replace('localidade_encontrado', 'localidade_encontrada'),
    );

    colunasEncontradas = cols.map((c) => `${c}_encontrado`).join(', ');
    colunasEncontradas = `, ${colunasEncontradas}, cod_setor`;

    additionalCols = options.keyCols.map((c) => `${y}.${c} AS ${c}_encontrado`).join(', ');

    additionalCols = additionalCols.replace('localidade_encontrado', 'localidade_encontrada');
    additionalCols = `, ${additionalCols}, ${y}.cod_setor AS cod_setor`;
  }

  const query = `
    INSERT INTO ${options.outputTable} (
      tempidgeocodebr, lat, lon, endereco_encontrado, tipo_resultado,
      desvio_metros, log_causa_confusao, contagem_cnefe ${colunasEncontradas}
    )
    SELECT 
      ${x}.tempidgeocodebr,
      ${y}.lat,
      ${y}.lon,
      ${y}.endereco_completo AS endereco_encontrado,
      '${options.matchType}' AS tipo_resultado,
      ${y}.desvio_metros,
      ${x}.log_causa_confusao,
      ${y}.n_casos AS contagem_cnefe ${additionalCols}
    FROM ${x}
    INNER JOIN ${y}
    ON ${joinCondition}
    WHERE ${colsNotNull};
  `;

  return new Promise((resolve, reject) => {
    db.exec(query, (err) => {
      if (err) return reject(err);

      // Aqui faríamos o UPDATE para deletar do input_padrao_db
      // as observações que acabaram de ser encontradas.
      const updateQuery = `
        DELETE FROM ${x}
        WHERE tempidgeocodebr IN (SELECT tempidgeocodebr FROM ${options.outputTable});
      `;

      db.exec(updateQuery, (errUpdate) => {
        if (errUpdate) return reject(errUpdate);
        resolve();
      });
    });
  });
}

function getProbMatchCutoff(matchType: MatchType): number {
  switch (matchType) {
    case 'pb01':
      return 0.85;
    case 'pb02':
      return 0.85;
    case 'pb03':
      return 0.85;
    case 'pb04':
      return 0.85;
    default:
      return 0.85; // Default cutoff
  }
}

/**
 * Calcula a distância de similaridade Jaro-Winkler entre os logradouros
 * e salva o mais provável na coluna temp_lograd_determ do input_padrao_db.
 */
async function calculateStringDist(
  options: MatchOptions,
  uniqueLogradourosTbl: string,
): Promise<void> {
  const db = await getDbConnection();
  const minCutoff = getProbMatchCutoff(options.matchType);
  const keyColsStringDist = options.keyCols.filter(
    (col) => col !== 'numero' && col !== 'logradouro',
  );

  const joinConditionLookup = keyColsStringDist
    .map((col) => `${uniqueLogradourosTbl}.${col} = input_padrao_db.${col}`)
    .join(' AND ');

  const colsNotNull = options.keyCols
    .map((col) => `input_padrao_db.${col} IS NOT NULL`)
    .join(' AND ');

  const queryCalcDist = `
    WITH to_compute AS (
      SELECT
          input_padrao_db.tempidgeocodebr,
          input_padrao_db.logradouro AS logradouro_input,
          ${uniqueLogradourosTbl}.logradouro AS logradouro_cnefe
      FROM input_padrao_db
      JOIN ${uniqueLogradourosTbl}
        ON ${joinConditionLookup}
      WHERE input_padrao_db.similaridade_logradouro IS NULL
        AND input_padrao_db.log_causa_confusao = FALSE
        AND ${colsNotNull}
    ),
    computed AS (
      SELECT
          tempidgeocodebr,
          logradouro_cnefe,
          CAST(jaro_winkler_similarity(logradouro_input, logradouro_cnefe) AS NUMERIC(5,3)) AS similarity,
          RANK() OVER (PARTITION BY tempidgeocodebr ORDER BY CAST(jaro_winkler_similarity(logradouro_input, logradouro_cnefe) AS NUMERIC(5,3)) DESC, logradouro_cnefe) AS rank
      FROM to_compute
      WHERE CAST(jaro_winkler_similarity(logradouro_input, logradouro_cnefe) AS NUMERIC(5,3)) > ${minCutoff}
    )
    UPDATE input_padrao_db
      SET temp_lograd_determ = computed.logradouro_cnefe,
          similaridade_logradouro = similarity
      FROM computed
      WHERE input_padrao_db.tempidgeocodebr = computed.tempidgeocodebr
            AND computed.rank = 1;
  `;

  return new Promise((resolve, reject) => {
    db.exec(queryCalcDist, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * Tradução de match_cases_probabilistic.R
 * Executa o cruzamento de dados com similaridade de strings (Jaro-Winkler).
 */
export async function matchCasesProbabilistic(options: MatchOptions): Promise<void> {
  const db = await getDbConnection();
  const cnefeTable = getReferenceTable(options.matchType);
  const x = options.inputTable;
  const y = cnefeTable;

  // 1. O ideal aqui é ter uma tabela de logradouros únicos do CNEFE pre-gerada (unique_logradouros_tbl)
  // Por ora, vamos assumir que existe uma view 'unique_logradouros_tbl' associada àquele matchType
  const uniqueLogradourosTbl = `unique_logradouros_${options.matchType}`;

  // 2. Atualizar o input_padrao_db com a similaridade calculada
  await calculateStringDist(options, uniqueLogradourosTbl);

  // 3. Atualizar o output_db com o match (substituindo logradouro por temp_lograd_determ)
  const joinConditionMatch = options.keyCols
    .map((col) =>
      col === 'logradouro' ? `${y}.${col} = ${x}.temp_lograd_determ` : `${y}.${col} = ${x}.${col}`,
    )
    .join(' AND ');

  const colsNotNull = options.keyCols
    .map((col) =>
      col === 'logradouro' ? `${x}.temp_lograd_determ IS NOT NULL` : `${x}.${col} IS NOT NULL`,
    )
    .join(' AND ');

  let colunasEncontradas = '';
  let additionalCols = '';

  if (options.resultadoCompleto) {
    const cols = options.keyCols.map((c) =>
      c.replace('localidade_encontrado', 'localidade_encontrada'),
    );
    colunasEncontradas = cols.map((c) => `${c}_encontrado`).join(', ');
    colunasEncontradas = `, ${colunasEncontradas}, similaridade_logradouro, cod_setor`;

    additionalCols = options.keyCols.map((c) => `${y}.${c} AS ${c}_encontrado`).join(', ');
    additionalCols = additionalCols.replace('localidade_encontrado', 'localidade_encontrada');
    additionalCols = `, ${additionalCols}, ${x}.similaridade_logradouro AS similaridade_logradouro, ${y}.cod_setor AS cod_setor`;
  }

  const queryUpdateDb = `
    INSERT INTO ${options.outputTable} (
      tempidgeocodebr, lat, lon, endereco_encontrado, tipo_resultado,
      desvio_metros, log_causa_confusao, contagem_cnefe ${colunasEncontradas}
    )
    SELECT 
      ${x}.tempidgeocodebr,
      ${y}.lat,
      ${y}.lon,
      ${y}.endereco_completo AS endereco_encontrado,
      '${options.matchType}' AS tipo_resultado,
      ${y}.desvio_metros,
      ${x}.log_causa_confusao,
      ${y}.n_casos AS contagem_cnefe ${additionalCols}
    FROM ${x}
    INNER JOIN ${y}
    ON ${joinConditionMatch}
    WHERE ${colsNotNull};
  `;

  return new Promise((resolve, reject) => {
    db.exec(queryUpdateDb, (err) => {
      if (err) return reject(err);

      const updateQuery = `
        DELETE FROM ${x}
        WHERE tempidgeocodebr IN (SELECT tempidgeocodebr FROM ${options.outputTable});
      `;

      db.exec(updateQuery, (errUpdate) => {
        if (errUpdate) return reject(errUpdate);
        resolve();
      });
    });
  });
}
