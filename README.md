# geocodebr-ts

Um poderoso geocodificador em TypeScript para o Brasil, construído em cima do banco de dados CNEFE (IBGE) via Parquet remotos e turbinado pelo DuckDB In-Memory SQL Engine.

Uma alternativa direta e ultrarrápida (in-memory) aos pacotes R (`enderecobr` / `geocodebr`), portado para o ecossistema Node/TypeScript.

## Instalação

```bash
npm install geocodebr-ts
```

_(Como o pacote utiliza o DuckDB nativo, certifique-se de estar num ambiente compatível com Node.js)_

## Como usar

O pacote exporta a função principal `geocode`, que recebe um array de endereços e retorna suas respectivas coordenadas, precisão e algoritmo utilizado.

```typescript
import { geocode } from 'geocodebr-ts';

async function main() {
  const enderecos = [
    {
      estado: 'SP',
      municipio: 'Sao Paulo',
      logradouro: 'Avenida Paulista',
      numero: '1578',
    },
    {
      estado: 'SC',
      municipio: 'Balneário Camboriú',
      logradouro: 'Avenida Brasil',
      numero: '10',
    },
  ];

  // A primeira vez fará o cache (via lazy stream) dos metadados do Parquet remoto.
  const resultados = await geocode(enderecos, { strategy: 'lazy' });

  console.log(resultados);
}

main();
```

### Exemplo de Resposta

```json
[
  {
    "lat": -23.561414,
    "lon": -46.656461,
    "precisao": 15,
    "endereco_encontrado": "AVENIDA PAULISTA, 1578 - SAO PAULO - SP",
    "tipo_resultado": "exato (com numero)"
  }
]
```

## Playground

Se você quiser testar e entender como o pacote funciona sem precisar escrever código:

1. Clone o repositório
2. Instale as dependências: `npm install`
3. Rode o playground: `npm run playground`

Uma página web será aberta onde você poderá inserir múltiplos endereços no formato texto/CSV e ver o `geocodebr-ts` agir em tempo real!

## Como funciona (Arquitetura)

Este projeto utiliza o banco de dados analítico **DuckDB** para instanciar a base do CNEFE diretamente a partir dos repositórios oficiais (`ipeaGIT/padronizacao_cnefe`) em arquivos compactados `.parquet`.

- O pacote converte chamadas Javascript numa cascata de consultas SQL super velozes.
- Realiza **Fuzzy Matching** robusto através da função nativa `jaro_winkler_similarity` diretamente no motor SQL.
- Fornece fallback seguro (se não achar o número na rua, retorna as coordenadas aproximadas da rua em vez de falhar ou errar de rua).

## Agradecimentos e Créditos

Este pacote open-source foi extraído e é mantido orgulhosamente pelo time do **[Gabriella GIS](https://www.gabriellagis.com)**.

<a href="https://www.gabriellagis.com" target="_blank">
  <img src="https://www.gabriellagis.com/logo-gabriella-gis.png" alt="Gabriella GIS Logo" height="60" />
</a>

Se você utilizar este pacote em seu projeto, site ou sistema empresarial, pedimos gentilmente que mantenha os créditos e considere referenciar o **Gabriella GIS** em sua página de agradecimentos/créditos.

## Licença

[MIT](LICENSE) - Fique livre para utilizar, modificar e distribuir este software de forma irrestrita. O único requisito é a manutenção do aviso de copyright original citando a **Gabriella GIS** no código.
