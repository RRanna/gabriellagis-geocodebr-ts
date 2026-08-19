import * as duckdbModule from 'duckdb';

const duckdb = duckdbModule.Database ? duckdbModule : (duckdbModule as any).default;

let dbInstance: duckdbModule.Database | null = null;
let dbConnection: duckdbModule.Connection | null = null;

export async function getDbConnection(): Promise<duckdbModule.Connection> {
  if (dbConnection) return dbConnection;

  return new Promise((resolve, reject) => {
    // In-memory duckdb
    dbInstance = new duckdb.Database(':memory:', (err: any) => {
      if (err) return reject(err);

      dbConnection = dbInstance!.connect();

      // Load necessary extensions
      dbInstance!.exec(
        `
        SET extension_directory = '/tmp';
        INSTALL httpfs; LOAD httpfs;
        INSTALL parquet; LOAD parquet;
        INSTALL spatial; LOAD spatial;
        SET enable_progress_bar = false;
      `,
        (err) => {
          if (err) return reject(err);
          resolve(dbConnection!);
        },
      );
    });
  });
}

export function closeDbConnection() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbConnection = null;
  }
}
