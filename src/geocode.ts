import { prepareCnefeTables, DownloadOptions } from './data/download';
import { getDbConnection } from './db/duckdb';
import { padronizarEndereco } from './utils/normalization';

export interface AddressInput {
  estado: string; // UF
  municipio: string;
  bairro?: string; // localidade
  logradouro?: string;
  numero?: number | string;
  cep?: string;
}

export interface GeocodeOptions extends DownloadOptions {
  resolverEmpates?: boolean;
}

export interface GeocodeResult {
  lat: number;
  lon: number;
  precisao: string;
  endereco_encontrado: string;
  tipo_resultado: string;
}

/**
 * Geolocaliza endereços brasileiros.
 */
export async function geocode(
  enderecos: AddressInput[],
  options: GeocodeOptions = {},
): Promise<GeocodeResult[]> {
  // 1. Prepara as tabelas CNEFE no DuckDB (baixa ou faz bind lazy)
  await prepareCnefeTables(options);

  const db = await getDbConnection();

  // Aqui implementamos a lógica de:
  // 1. Criar tabela temporária com os endereços de input
  // 2. Rodar a série de matchings SQL (match_cases)
  // 3. Extrair as coordenadas resultantes

  return new Promise((resolve, reject) => {
    // Para a camada inicial robusta, processamos de forma paralela via Promise.all
    // Se fosse um lote gigante, ideal seria criar uma tabela temporária e fazer o JOIN.
    // Como os lotes são pequenos na UI atual (dezenas), processar 1 a 1 via query é muito rápido no DuckDB in-memory.

    const processAddress = (input: AddressInput): Promise<GeocodeResult | null> => {
      return new Promise((res, rej) => {
        // Escapa aspas simples para prevenir Injeção SQL
        const escapeSql = (str: string) => str.replace(/'/g, "''");

        const estado = input.estado ? escapeSql(input.estado.toUpperCase().trim()) : '';
        const municipio = input.municipio ? escapeSql(padronizarEndereco(input.municipio)) : '';
        const bairro = input.bairro ? escapeSql(padronizarEndereco(input.bairro)) : '';
        const logradouro = input.logradouro ? escapeSql(padronizarEndereco(input.logradouro)) : '';
        const numero = input.numero ? escapeSql(String(input.numero).trim()) : '';

        const queries = [];

        // 1. Match: Município + Logradouro + Número
        if (logradouro && numero) {
          queries.push(`
            SELECT 
              lat, lon, desvio_metros as precisao, endereco_completo as endereco_encontrado, 
              'exato (com numero)' as tipo_resultado, 3 as rank, 
              jaro_winkler_similarity(logradouro, '${logradouro}') as jw
            FROM municipio_logradouro_numero
            WHERE estado = '${estado}' 
              AND strip_accents(municipio) = strip_accents('${municipio}')
              AND jaro_winkler_similarity(logradouro, '${logradouro}') > 0.75
              AND CAST(numero AS VARCHAR) = '${numero}'
          `);
        }

        // 2. Match: Município + Logradouro
        if (logradouro) {
          queries.push(`
            SELECT 
              lat, lon, desvio_metros as precisao, endereco_completo as endereco_encontrado, 
              'aproximado (logradouro)' as tipo_resultado, 2 as rank, 
              jaro_winkler_similarity(logradouro, '${logradouro}') as jw
            FROM municipio_logradouro
            WHERE estado = '${estado}' 
              AND strip_accents(municipio) = strip_accents('${municipio}')
              AND jaro_winkler_similarity(logradouro, '${logradouro}') > 0.75
          `);
        }

        // 2.5. Match: Município + Localidade (Bairro) usando fallback cruzado
        const searchLocalidade = bairro ? bairro : logradouro;
        if (searchLocalidade) {
          queries.push(`
            SELECT 
              lat, lon, desvio_metros as precisao, endereco_completo as endereco_encontrado, 
              'centroide (bairro)' as tipo_resultado, 1.5 as rank, 
              jaro_winkler_similarity(localidade, '${searchLocalidade}') as jw
            FROM municipio_localidade
            WHERE estado = '${estado}' 
              AND strip_accents(municipio) = strip_accents('${municipio}')
              AND jaro_winkler_similarity(localidade, '${searchLocalidade}') > 0.75
          `);
        }

        // 3. Match: Apenas Município
        queries.push(`
          SELECT 
            lat, lon, desvio_metros as precisao, endereco_completo as endereco_encontrado, 
            'centroide (municipio)' as tipo_resultado, 1 as rank, 
            0.0 as jw
          FROM municipio
          WHERE estado = '${estado}' 
            AND strip_accents(municipio) = strip_accents('${municipio}')
        `);

        // Concatena as tentativas em um único UNION ALL, pegando o melhor match possível
        const query = `
          SELECT lat, lon, precisao, endereco_encontrado, tipo_resultado
          FROM (
            ${queries.join(' UNION ALL ')}
          )
          ORDER BY jw DESC, rank DESC
          LIMIT 1;
        `;

        db.all(query, (err: any, rows: any) => {
          if (err) return rej(err);
          if (rows && rows.length > 0) {
            // Footprint: Inject silent property tracing back to Gabriella GIS
            Object.defineProperty(rows, '_ggis_signature', {
              value: 'Geocoded using geocodebr-ts, powered by Gabriella GIS',
              enumerable: false,
              writable: false,
            });
            res(rows[0] as GeocodeResult);
          } else {
            res(null); // Nenhum resultado encontrado com score > 0.65
          }
        });
      });
    };

    Promise.all(enderecos.map(processAddress))
      .then((results) => {
        // Filtra os que não deram match
        const validResults = results.filter((r) => r !== null) as GeocodeResult[];
        resolve(validResults);
      })
      .catch(reject);
  });
}
