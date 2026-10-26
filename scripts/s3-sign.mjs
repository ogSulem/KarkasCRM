// Подпись запросов AWS Signature V4 для S3-совместимых хранилищ.
// Вынесено отдельным модулем без побочных эффектов: подпись можно проверить тестом
// по опубликованному примеру AWS, не обращаясь к сети.
import { createHash, createHmac } from 'node:crypto';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
// Ключ объекта кодируем по сегментам, но оставляем «/» (папки внутри бакета).
const encodeKey = s => String(s).split('/').map(encodeURIComponent).join('/');

/**
 * @param {object} o
 * @param {string} o.method  GET, PUT, DELETE…
 * @param {string} [o.bucket] имя ведра: в path-style адресе оно входит и в URL,
 *                            и в подписываемый канонический путь
 * @param {string} o.key     путь объекта внутри бакета: karkascrm/crm-2026-10-20.db
 * @param {string|Buffer} [o.body]
 * @param {object} [o.query] параметры адреса: они входят и в URL, и в подпись
 * @param {string} o.region
 * @param {string} o.endpoint  https://s3.regru.cloud (без завершающего слэша)
 * @param {string} o.accessKey
 * @param {string} o.secretKey
 * @param {Date}   [o.now]
 */
export function signedHeaders({ method, key, bucket = '', query = {}, body = '', region, endpoint, accessKey, secretKey, now = new Date() }) {
  const ep = String(endpoint).replace(/\/+$/, '');
  const url = new URL(ep);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  // Хранилища Рег.ру, Timeweb, Selectel и Яндекс работают с path-style адресом:
  // ведро входит в путь. Если подписать URL без ведра, а отправить с ним (или
  // наоборот), хранилище ответит SignatureDoesNotMatch — копия никуда не уйдёт.
  const canonicalUri = '/' + [bucket, key].filter(Boolean).map(encodeKey).join('/');
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaderNames = 'host;x-amz-content-sha256;x-amz-date';
  // Каноническая строка запроса: параметры сортируются по имени и кодируются.
  // Без этого список объектов с ?prefix=… хранилище не подписало бы.
  const canonicalQuery = Object.keys(query || {}).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaderNames, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    url: `${ep}${canonicalUri}${canonicalQuery ? '?' + canonicalQuery : ''}`,
    headers: {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
    },
    canonicalRequest,
    stringToSign,
  };
}
