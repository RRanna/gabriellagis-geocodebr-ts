import { prepareCnefeTables } from './src/data/download';
import { getDbConnection, closeDbConnection } from './src/db/duckdb';

async function runTest() {
  console.log('Iniciando teste da integração DuckDB com Parquet via HTTP...');
  console.time('Tempo de inicialização e montagem das views');

  try {
    // Inicializa o banco e monta as views (via HTTP Range Requests - strategy: 'lazy')
    await prepareCnefeTables({ strategy: 'lazy', dataRelease: 'v0.4.1' });
    console.timeEnd('Tempo de inicialização e montagem das views');

    console.log(
      '\\nConsultando o banco (isso fará o DuckDB baixar apenas os bytes necessários do Github)...',
    );
    const db = await getDbConnection();

    // Testa lendo 5 municípios diretamente da view 'municipio' (que aponta pro Github!)
    db.all('SELECT * FROM municipio LIMIT 5;', (err, rows) => {
      if (err) {
        console.error('Erro na consulta:', err);
      } else {
        console.log('\\n--- 5 Primeiros Municípios Encontrados ---');
        console.table(rows);
      }

      closeDbConnection();
      console.log('\\nTeste concluído com sucesso!');
    });
  } catch (error) {
    console.error('Erro ao rodar o teste:', error);
    closeDbConnection();
  }
}

runTest();
