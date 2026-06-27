import { filenameToDisplayTitle } from '../../lib/title.js';

const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.webm'];
const R2_BUCKET_NAME = 'music';

async function hmacSha256(key, data) {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const dataData = typeof data === 'string' ? encoder.encode(data) : data;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataData);
  return new Uint8Array(signature);
}

function uint8ArrayToHex(arr) {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function createSignature(
  method,
  url,
  headers,
  accessKeyId,
  secretAccessKey,
  region = 'auto',
  payloadHash = 'UNSIGNED-PAYLOAD',
) {
  const urlObj = new URL(url);
  const host = urlObj.hostname;
  const path = urlObj.pathname;
  const query = urlObj.search;

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');

  const dateStamp = `${year}${month}${day}`;
  const date = `${dateStamp}T${hours}${minutes}${seconds}Z`;

  const headersWithContentSha256 = {
    ...headers,
    'x-amz-content-sha256': payloadHash,
  };

  const sortedHeaderKeys = Object.keys(headersWithContentSha256).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((key) => `${key.toLowerCase()}:${headersWithContentSha256[key]}\n`)
    .join('');

  const signedHeaders = sortedHeaderKeys.map((key) => key.toLowerCase()).join(';');

  const canonicalRequest = [
    method,
    path,
    query.replace(/^\?/, ''),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const encoder = new TextEncoder();
  const canonicalRequestBytes = encoder.encode(canonicalRequest);

  const hashBuffer = await crypto.subtle.digest('SHA-256', canonicalRequestBytes);
  const canonicalRequestHashHex = uint8ArrayToHex(new Uint8Array(hashBuffer));

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [algorithm, date, credentialScope, canonicalRequestHashHex].join('\n');

  const kDate = await hmacSha256(
    encoder.encode('AWS4' + secretAccessKey),
    encoder.encode(dateStamp),
  );
  const kRegion = await hmacSha256(kDate, encoder.encode(region));
  const kService = await hmacSha256(kRegion, encoder.encode('s3'));
  const kSigning = await hmacSha256(kService, encoder.encode('aws4_request'));
  const signature = await hmacSha256(kSigning, encoder.encode(stringToSign));
  const signatureHex = uint8ArrayToHex(signature);

  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signatureHex}`;

  return {
    Authorization: authorization,
    'X-Amz-Date': date,
    'x-amz-content-sha256': payloadHash,
    Host: host,
  };
}

async function r2ListObjects(accountId, accessKeyId, secretAccessKey, bucketName) {
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const url = `${endpoint}/${bucketName}?list-type=2`;

  const headers = {
    Host: `${accountId}.r2.cloudflarestorage.com`,
  };

  const authHeaders = await createSignature('GET', url, headers, accessKeyId, secretAccessKey);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...authHeaders,
      Accept: 'application/xml',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`R2 ListObjects failed: ${response.status} ${text}`);
  }

  const xml = await response.text();

  const objects = [];
  const contentsRegex = /<Contents>(.*?)<\/Contents>/gs;
  let match;

  while ((match = contentsRegex.exec(xml)) !== null) {
    const contentXml = match[1];

    const keyMatch = contentXml.match(/<Key>(.*?)<\/Key>/);
    const sizeMatch = contentXml.match(/<Size>(.*?)<\/Size>/);
    const lastModifiedMatch = contentXml.match(/<LastModified>(.*?)<\/LastModified>/);

    const key = keyMatch ? keyMatch[1] : null;
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
    const lastModified = lastModifiedMatch ? lastModifiedMatch[1] : null;

    if (key) {
      objects.push({
        Key: key,
        Size: size,
        LastModified: lastModified ? new Date(lastModified) : null,
      });
    }
  }

  return { Contents: objects };
}

async function r2GetObject(accountId, accessKeyId, secretAccessKey, bucketName, key, range = null) {
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const url = `${endpoint}/${bucketName}/${encodeURIComponent(key)}`;

  const headers = {
    Host: `${accountId}.r2.cloudflarestorage.com`,
  };

  if (range) {
    headers['Range'] = range;
  }

  const authHeaders = await createSignature('GET', url, headers, accessKeyId, secretAccessKey);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...authHeaders,
      ...(range ? { Range: range } : {}),
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      const error = new Error('NotFound');
      error.name = 'NotFound';
      throw error;
    }
    const text = await response.text();
    throw new Error(`R2 GetObject failed: ${response.status} ${text}`);
  }

  return {
    Body: response.body,
    ContentType: response.headers.get('content-type') || 'audio/mpeg',
    ContentLength: parseInt(response.headers.get('content-length') || '0', 10),
    StatusCode: response.status,
  };
}

async function r2HeadObject(accountId, accessKeyId, secretAccessKey, bucketName, key) {
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const url = `${endpoint}/${bucketName}/${encodeURIComponent(key)}`;

  const headers = {
    Host: `${accountId}.r2.cloudflarestorage.com`,
  };

  const authHeaders = await createSignature('HEAD', url, headers, accessKeyId, secretAccessKey);

  const response = await fetch(url, {
    method: 'HEAD',
    headers: authHeaders,
  });

  if (!response.ok) {
    if (response.status === 404) {
      const error = new Error('NotFound');
      error.name = 'NotFound';
      throw error;
    }
    const text = await response.text();
    throw new Error(`R2 HeadObject failed: ${response.status} ${text}`);
  }

  return {
    ContentType: response.headers.get('content-type') || 'audio/mpeg',
    ContentLength: parseInt(response.headers.get('content-length') || '0', 10),
  };
}

async function r2PutObject(
  accountId,
  accessKeyId,
  secretAccessKey,
  bucketName,
  key,
  data,
  contentType,
) {
  try {
    console.log('[api/r2] r2PutObject 开始:', {
      bucketName,
      key,
      dataSize: data.length,
      contentType,
    });

    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    const url = `${endpoint}/${bucketName}/${encodeURIComponent(key)}`;

    console.log('[api/r2] 计算 payload hash...');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const payloadHash = uint8ArrayToHex(new Uint8Array(hashBuffer));
    console.log('[api/r2] Payload hash 计算完成:', payloadHash.substring(0, 16) + '...');

    const headers = {
      Host: `${accountId}.r2.cloudflarestorage.com`,
      'Content-Type': contentType,
      'Content-Length': data.length.toString(),
    };

    console.log('[api/r2] 创建签名...');
    const authHeaders = await createSignature(
      'PUT',
      url,
      headers,
      accessKeyId,
      secretAccessKey,
      'auto',
      payloadHash,
    );
    console.log('[api/r2] 签名创建完成');

    console.log('[api/r2] 发送 PUT 请求到 R2...');
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...authHeaders,
        'Content-Type': contentType,
        'Content-Length': data.length.toString(),
      },
      body: data,
    });

    console.log('[api/r2] R2 PUT 响应:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[api/r2] R2 PutObject 失败:', {
        status: response.status,
        statusText: response.statusText,
        errorText: text,
      });
      throw new Error(`R2 PutObject failed: ${response.status} ${text}`);
    }

    console.log('[api/r2] r2PutObject 成功');
    return { success: true };
  } catch (error) {
    console.error('[api/r2] r2PutObject 错误:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
    });
    throw error;
  }
}

// 生成 R2 直传预签名 URL（PUT）
async function createPresignedPutUrl(
  accountId,
  accessKeyId,
  secretAccessKey,
  bucketName,
  key,
  contentType = 'application/octet-stream',
  expires = 900,
) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}`;
  const encodedKey = encodeURIComponent(key);
  const canonicalUri = `/${bucketName}/${encodedKey}`;

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');

  const dateStamp = `${year}${month}${day}`;
  const amzDate = `${dateStamp}T${hours}${minutes}${seconds}Z`;
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

  const safeExpires = Math.min(Math.max(Number(expires) || 900, 60), 3600);

  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(safeExpires),
    'X-Amz-SignedHeaders': 'host',
  });

  const canonicalQueryString = params.toString();
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const encoder = new TextEncoder();
  const canonicalRequestHash = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(canonicalRequest),
  );
  const canonicalRequestHashHex = uint8ArrayToHex(new Uint8Array(canonicalRequestHash));

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, canonicalRequestHashHex].join(
    '\n',
  );

  const kDate = await hmacSha256(
    encoder.encode('AWS4' + secretAccessKey),
    encoder.encode(dateStamp),
  );
  const kRegion = await hmacSha256(kDate, encoder.encode('auto'));
  const kService = await hmacSha256(kRegion, encoder.encode('s3'));
  const kSigning = await hmacSha256(kService, encoder.encode('aws4_request'));
  const signature = await hmacSha256(kSigning, encoder.encode(stringToSign));
  const signatureHex = uint8ArrayToHex(signature);

  const presignedUrl = `${endpoint}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signatureHex}`;

  return {
    url: presignedUrl,
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    expires: safeExpires,
  };
}

export async function onRequest(context) {
  try {
    const { request, env } = context;

    console.log('[api/r2] onRequest 收到请求:', {
      method: request.method,
      url: request.url,
      hasEnv: !!env,
    });

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const result = await handleR2Request(request, env, corsHeaders);
    console.log('[api/r2] onRequest 处理完成:', {
      status: result.status,
      statusText: result.statusText,
    });
    return result;
  } catch (error) {
    console.error('[api/r2] onRequest 错误:', {
      message: error?.message || String(error),
      name: error?.name,
      stack: error?.stack,
    });

    const errorInfo = {
      error: 'R2 API 错误',
      message: error?.message || String(error),
      name: error?.name,
    };

    if (error?.stack) {
      errorInfo.stack = error.stack;
    }

    return new Response(JSON.stringify(errorInfo), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'content-type': 'application/json',
      },
    });
  }
}

async function handleR2Request(request, env, corsHeaders) {
  try {
    const accountId = String(env?.ACCOUNT_ID || '').trim();
    const accessKeyId = String(env?.ACCESS_KEY_ID || '').trim();
    const secretAccessKey = String(env?.SECRET_ACCESS_KEY || '').trim();

    if (!accountId || !accessKeyId || !secretAccessKey) {
      const missingVars = [];
      if (!accountId) missingVars.push('ACCOUNT_ID');
      if (!accessKeyId) missingVars.push('ACCESS_KEY_ID');
      if (!secretAccessKey) missingVars.push('SECRET_ACCESS_KEY');

      return new Response(
        JSON.stringify({
          error: 'R2存储桶未配置',
          message: '请设置环境变量',
          missing: missingVars,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        },
      );
    }

    const bucketName = R2_BUCKET_NAME;
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const action = url.searchParams.get('action');
      const key = url.searchParams.get('key');

      if (action === 'list') {
        try {
          const response = await r2ListObjects(accountId, accessKeyId, secretAccessKey, bucketName);
          const objects = response.Contents || [];

          const audioFiles = objects
            .filter((obj) => {
              const name = obj.Key.toLowerCase();
              return AUDIO_EXTS.some((ext) => name.endsWith(ext));
            })
            .map((obj) => {
              const name = obj.Key;
              const title = filenameToDisplayTitle(name) || name;

              const fileUrl = `/api/r2?key=${encodeURIComponent(name)}`;

              return {
                name: name,
                title: title,
                url: fileUrl,
                size: obj.Size,
                uploaded: obj.LastModified,
              };
            });

          return new Response(
            JSON.stringify({
              success: true,
              total: audioFiles.length,
              data: audioFiles,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, 'content-type': 'application/json' },
            },
          );
        } catch (error) {
          console.error('[api/r2] 列表获取错误:', error);
          return new Response(
            JSON.stringify({
              error: '获取歌曲列表失败',
              message: error.message,
            }),
            {
              status: 500,
              headers: { ...corsHeaders, 'content-type': 'application/json' },
            },
          );
        }
      }

      // 生成预签名直传 URL：/api/r2?action=sign&key=xxx[&contentType=audio/mpeg][&expires=900]
      if (action === 'sign') {
        const signKey = url.searchParams.get('key') || '';
        const contentType = url.searchParams.get('contentType') || 'application/octet-stream';
        const expires = Number(url.searchParams.get('expires') || 900);

        if (!signKey) {
          return new Response(JSON.stringify({ error: '缺少 key 参数' }), {
            status: 400,
            headers: corsHeaders,
          });
        }

        try {
          const presigned = await createPresignedPutUrl(
            accountId,
            accessKeyId,
            secretAccessKey,
            bucketName,
            signKey,
            contentType,
            expires,
          );
          return new Response(
            JSON.stringify({
              success: true,
              uploadUrl: presigned.url,
              method: presigned.method,
              headers: presigned.headers,
              key: signKey,
              expires: presigned.expires,
              contentType,
              accessUrl: `/api/r2?key=${encodeURIComponent(signKey)}`,
            }),
            {
              status: 200,
              headers: corsHeaders,
            },
          );
        } catch (error) {
          console.error('[edge/api/r2] 预签名失败:', error);
          return new Response(
            JSON.stringify({
              error: '生成预签名URL失败',
              message: error.message,
            }),
            {
              status: 500,
              headers: corsHeaders,
            },
          );
        }
      }

      if (!key) {
        return new Response(JSON.stringify({ error: '缺少 key 参数' }), {
          status: 400,
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }

      try {
        let contentType = 'audio/mpeg';
        let contentLength = 0;

        try {
          const headResponse = await r2HeadObject(
            accountId,
            accessKeyId,
            secretAccessKey,
            bucketName,
            key,
          );
          contentType = headResponse.ContentType || 'audio/mpeg';
          contentLength = headResponse.ContentLength || 0;
        } catch (headError) {
          if (headError.name === 'NotFound') {
            return new Response(JSON.stringify({ error: '文件不存在' }), {
              status: 404,
              headers: { ...corsHeaders, 'content-type': 'application/json' },
            });
          }
          throw headError;
        }

        const fileNameLower = key.toLowerCase();
        if (fileNameLower.endsWith('.mp3')) contentType = 'audio/mpeg';
        else if (fileNameLower.endsWith('.wav')) contentType = 'audio/wav';
        else if (fileNameLower.endsWith('.flac')) contentType = 'audio/flac';
        else if (fileNameLower.endsWith('.aac')) contentType = 'audio/aac';
        else if (fileNameLower.endsWith('.m4a')) contentType = 'audio/mp4';
        else if (fileNameLower.endsWith('.ogg')) contentType = 'audio/ogg';
        else if (fileNameLower.endsWith('.opus')) contentType = 'audio/opus';
        else if (fileNameLower.endsWith('.webm')) contentType = 'audio/webm';

        const rangeHeader = request.headers.get('range');
        let range = null;
        if (rangeHeader) {
          const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : contentLength - 1;
            range = `bytes=${start}-${end}`;
          }
        }

        const objectResponse = await r2GetObject(
          accountId,
          accessKeyId,
          secretAccessKey,
          bucketName,
          key,
          range,
        );

        const responseHeaders = {
          ...corsHeaders,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable',
        };

        if (range) {
          const [start, end] = range.replace('bytes=', '').split('-').map(Number);
          const rangeLength = end - start + 1;

          responseHeaders['Content-Range'] = `bytes ${start}-${end}/${contentLength}`;

          const actualContentLength = objectResponse.ContentLength || rangeLength;
          responseHeaders['Content-Length'] = actualContentLength.toString();

          if (objectResponse.StatusCode === 206) {
            return new Response(objectResponse.Body, {
              status: 206,
              headers: responseHeaders,
            });
          } else {
            const reader = objectResponse.Body.getReader();
            const chunks = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }

            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const combined = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
              combined.set(chunk, offset);
              offset += chunk.length;
            }

            return new Response(combined, {
              status: 206,
              headers: responseHeaders,
            });
          }
        } else {
          responseHeaders['Content-Length'] = contentLength.toString();
          return new Response(objectResponse.Body, {
            status: 200,
            headers: responseHeaders,
          });
        }
      } catch (error) {
        console.error('[api/r2] 文件获取错误:', error);
        if (error.name === 'NotFound') {
          return new Response(JSON.stringify({ error: '文件不存在' }), {
            status: 404,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            error: '获取文件失败',
            message: error.message,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          },
        );
      }
    }

    if (request.method === 'POST') {
      try {
        const contentType = request.headers.get('content-type') || '';

        let fileName = '';
        let fileData = null;
        let mimeType = 'audio/mpeg';

        if (contentType.includes('multipart/form-data')) {
          return new Response(
            JSON.stringify({
              error: 'multipart/form-data 上传需要使用 JSON 格式',
            }),
            {
              status: 501,
              headers: { ...corsHeaders, 'content-type': 'application/json' },
            },
          );
        }

        const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
        const MAX_REQUEST_SIZE = 10 * 1024 * 1024;

        console.log('[api/r2] 请求大小:', contentLength, 'bytes');

        if (contentLength > MAX_REQUEST_SIZE) {
          return new Response(
            JSON.stringify({
              error: '文件太大',
              message: `请求体大小 (${(contentLength / 1024 / 1024).toFixed(2)}MB) 超过限制 (${MAX_REQUEST_SIZE / 1024 / 1024}MB)，请使用较小的文件或通过 sourceUrl 上传`,
            }),
            {
              status: 413,
              headers: { ...corsHeaders, 'content-type': 'application/json' },
            },
          );
        }

        let body = {};
        try {
          console.log('[api/r2] 开始解析 JSON...');
          body = await request.json();
          console.log('[api/r2] JSON 解析完成');
        } catch (jsonError) {
          console.error('[api/r2] JSON 解析错误:', jsonError);
          return new Response(
            JSON.stringify({
              error: '请求体格式错误',
              message: jsonError.message,
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'content-type': 'application/json' },
            },
          );
        }

        fileName = body.fileName || '';
        const base64 = body.base64 || '';
        const sourceUrl = body.sourceUrl || '';

        const MAX_FILE_SIZE = 10 * 1024 * 1024;

        if (!fileName) {
          return new Response(JSON.stringify({ error: '缺少 fileName' }), {
            status: 400,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          });
        }

        try {
          await r2HeadObject(accountId, accessKeyId, secretAccessKey, bucketName, fileName);
          return new Response(JSON.stringify({ error: '文件已存在', exists: true }), {
            status: 409,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          });
        } catch (headError) {
          if (headError.name !== 'NotFound') {
            console.error('[api/r2] HeadObject 错误:', headError);
            return new Response(
              JSON.stringify({
                error: '检查文件存在性失败',
                message: headError.message,
              }),
              {
                status: 500,
                headers: { ...corsHeaders, 'content-type': 'application/json' },
              },
            );
          }
        }

        if (base64) {
          try {
            const estimatedSize = (base64.length * 3) / 4;
            if (estimatedSize > MAX_FILE_SIZE) {
              return new Response(
                JSON.stringify({
                  error: '文件太大',
                  message: `文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)，请使用 sourceUrl 上传`,
                }),
                {
                  status: 413,
                  headers: { ...corsHeaders, 'content-type': 'application/json' },
                },
              );
            }

            console.log('[api/r2] Base64 解码开始，大小:', estimatedSize);
            const binaryString = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            fileData = binaryString;
            console.log('[api/r2] Base64 解码完成，实际大小:', fileData.length);
          } catch (base64Error) {
            console.error('[api/r2] Base64 解码错误:', base64Error);
            return new Response(
              JSON.stringify({
                error: 'Base64 解码失败',
                message: base64Error.message,
              }),
              {
                status: 400,
                headers: { ...corsHeaders, 'content-type': 'application/json' },
              },
            );
          }
        } else if (sourceUrl) {
          try {
            const upstream = await fetch(sourceUrl, {
              redirect: 'follow',
              headers: {
                'User-Agent': 'web-music-player/0.1',
                Accept: 'audio/*,*/*',
              },
            });

            if (!upstream.ok) {
              return new Response(
                JSON.stringify({
                  error: `下载源文件失败: ${upstream.status}`,
                }),
                {
                  status: 502,
                  headers: { ...corsHeaders, 'content-type': 'application/json' },
                },
              );
            }

            const contentLengthHeader = upstream.headers.get('content-length');
            if (contentLengthHeader) {
              const fileSize = parseInt(contentLengthHeader, 10);
              if (fileSize > MAX_FILE_SIZE) {
                return new Response(
                  JSON.stringify({
                    error: '文件太大',
                    message: `文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)`,
                  }),
                  {
                    status: 413,
                    headers: { ...corsHeaders, 'content-type': 'application/json' },
                  },
                );
              }
            }

            fileData = new Uint8Array(await upstream.arrayBuffer());

            if (fileData.length > MAX_FILE_SIZE) {
              return new Response(
                JSON.stringify({
                  error: '文件太大',
                  message: `文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)`,
                }),
                {
                  status: 413,
                  headers: { ...corsHeaders, 'content-type': 'application/json' },
                },
              );
            }

            const contentTypeHeader = upstream.headers.get('content-type');
            if (contentTypeHeader) {
              mimeType = contentTypeHeader;
            }
          } catch (e) {
            console.error('[api/r2] 下载源文件错误:', e);
            return new Response(
              JSON.stringify({
                error: `下载源文件错误: ${e.message}`,
              }),
              {
                status: 502,
                headers: { ...corsHeaders, 'content-type': 'application/json' },
              },
            );
          }
        } else {
          return new Response(JSON.stringify({ error: '缺少文件数据、base64 或 sourceUrl' }), {
            status: 400,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          });
        }

        if (!fileData || fileData.length === 0) {
          return new Response(JSON.stringify({ error: '文件数据为空' }), {
            status: 400,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          });
        }

        if (fileData.length > MAX_FILE_SIZE) {
          return new Response(
            JSON.stringify({
              error: '文件太大',
              message: `文件大小 (${(fileData.length / 1024 / 1024).toFixed(2)}MB) 超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)`,
            }),
            {
              status: 413,
              headers: { ...corsHeaders, 'content-type': 'application/json' },
            },
          );
        }

        const fileNameLower = fileName.toLowerCase();
        if (fileNameLower.endsWith('.mp3')) mimeType = 'audio/mpeg';
        else if (fileNameLower.endsWith('.wav')) mimeType = 'audio/wav';
        else if (fileNameLower.endsWith('.flac')) mimeType = 'audio/flac';
        else if (fileNameLower.endsWith('.aac')) mimeType = 'audio/aac';
        else if (fileNameLower.endsWith('.m4a')) mimeType = 'audio/mp4';
        else if (fileNameLower.endsWith('.ogg')) mimeType = 'audio/ogg';
        else if (fileNameLower.endsWith('.opus')) mimeType = 'audio/opus';
        else if (fileNameLower.endsWith('.webm')) mimeType = 'audio/webm';

        console.log('[api/r2] 准备上传文件:', {
          fileName,
          fileSize: fileData.length,
          mimeType,
        });

        await r2PutObject(
          accountId,
          accessKeyId,
          secretAccessKey,
          bucketName,
          fileName,
          fileData,
          mimeType,
        );

        const rawUrl = `/api/r2?key=${encodeURIComponent(fileName)}`;

        return new Response(
          JSON.stringify({
            ok: true,
            rawUrl,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          },
        );
      } catch (postError) {
        console.error('[api/r2] POST 请求处理错误:', postError);
        return new Response(
          JSON.stringify({
            error: '上传失败',
            message: postError.message,
            name: postError.name,
            stack: postError.stack,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          },
        );
      }
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (error) {
    console.error('[api/r2] handleR2Request 错误:', error);
    return new Response(
      JSON.stringify({
        error: 'R2 API 错误',
        message: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      },
    );
  }
}
