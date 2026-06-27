import { filenameToDisplayTitle } from '../../lib/title.js';

export const onRequestGet = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Range',
      'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges',
    };

    const r2Bucket = env.MUSIC;
    if (!r2Bucket) {
      return new Response(JSON.stringify({ error: 'R2存储桶未配置' }), {
        status: 500,
        headers: {
          'content-type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    if (action === 'list') {
      try {
        const objects = await r2Bucket.list();
        const audioExts = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.webm'];
        const audioFiles = objects.objects
          .filter((obj) => {
            const name = obj.key.toLowerCase();
            return audioExts.some((ext) => name.endsWith(ext));
          })
          .map((obj) => {
            const name = obj.key;
            const title = filenameToDisplayTitle(name) || name;
            return {
              name: name,
              title: title,
              url: `/api/r2?key=${encodeURIComponent(obj.key)}`,
              size: obj.size,
              uploaded: obj.uploaded,
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
            headers: {
              'content-type': 'application/json',
              ...corsHeaders,
            },
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
            headers: {
              'content-type': 'application/json',
              ...corsHeaders,
            },
          },
        );
      }
    }

    // 预签名直传：/api/r2?action=sign&key=xxx[&contentType=audio/mpeg][&expires=900]
    if (action === 'sign') {
      const key = url.searchParams.get('key') || '';
      const contentType = url.searchParams.get('contentType') || 'application/octet-stream';
      const expires = Number(url.searchParams.get('expires') || 900); // 秒

      if (!key) {
        return new Response(JSON.stringify({ error: '缺少 key 参数' }), {
          status: 400,
          headers: {
            'content-type': 'application/json',
            ...corsHeaders,
          },
        });
      }

      try {
        const presigned = await r2Bucket.createPresignedUrl({
          method: 'PUT',
          key,
          expires,
          headers: {
            'content-type': contentType,
          },
        });

        return new Response(
          JSON.stringify({
            success: true,
            uploadUrl: presigned.url,
            key,
            expires,
            contentType,
            headers: presigned.headers || {},
            accessUrl: `/api/r2?key=${encodeURIComponent(key)}`,
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              ...corsHeaders,
            },
          },
        );
      } catch (error) {
        console.error('[api/r2] 预签名失败:', error);
        return new Response(
          JSON.stringify({
            error: '生成预签名URL失败',
            message: error.message,
          }),
          {
            status: 500,
            headers: {
              'content-type': 'application/json',
              ...corsHeaders,
            },
          },
        );
      }
    }

    const key = url.searchParams.get('key');
    if (!key) {
      return new Response(JSON.stringify({ error: '缺少 key 参数' }), {
        status: 400,
        headers: {
          'content-type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    try {
      const object = await r2Bucket.get(key);

      if (!object) {
        return new Response(JSON.stringify({ error: '文件不存在' }), {
          status: 404,
          headers: {
            'content-type': 'application/json',
            ...corsHeaders,
          },
        });
      }

      const rangeHeader = request.headers.get('range');
      let status = 200;
      let headers = {
        'content-type': object.httpMetadata?.contentType || 'audio/mpeg',
        'accept-ranges': 'bytes',
        ...corsHeaders,
      };

      if (rangeHeader) {
        const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : object.size - 1;

          const arrayBuffer = await object.arrayBuffer();
          const slicedBuffer = arrayBuffer.slice(start, end + 1);

          headers['content-range'] = `bytes ${start}-${end}/${object.size}`;
          headers['content-length'] = slicedBuffer.byteLength;

          return new Response(slicedBuffer, {
            status: 206,
            headers,
          });
        }
      }

      headers['content-length'] = object.size;
      headers['cache-control'] = 'public, max-age=31536000, immutable';

      return new Response(object.body, {
        status,
        headers,
      });
    } catch (error) {
      console.error('[api/r2] 文件获取错误:', error);
      return new Response(
        JSON.stringify({
          error: '获取文件失败',
          message: error.message,
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json',
            ...corsHeaders,
          },
        },
      );
    }
  } catch (error) {
    console.error('[api/r2] 错误:', error);
    return new Response(
      JSON.stringify({
        error: 'R2 API 错误',
        message: error.message,
      }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
      },
    );
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    };

    const r2Bucket = env.MUSIC;
    if (!r2Bucket) {
      return new Response(JSON.stringify({ error: 'R2存储桶未配置' }), {
        status: 500,
        headers: {
          'content-type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    const contentType = request.headers.get('content-type') || '';

    let fileName = '';
    let fileData = null;
    let base64 = '';
    let sourceUrl = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      fileName = formData.get('fileName') || '';

      if (!fileName && file && file.name) fileName = file.name;
      if (!fileName) {
        return new Response(JSON.stringify({ error: '缺少 fileName' }), {
          status: 400,
          headers: {
            'content-type': 'application/json',
            ...corsHeaders,
          },
        });
      }

      if (file && file.arrayBuffer) {
        fileData = await file.arrayBuffer();
      } else {
        return new Response(JSON.stringify({ error: '缺少文件数据' }), {
          status: 400,
          headers: {
            'content-type': 'application/json',
            ...corsHeaders,
          },
        });
      }
    } else {
      const body = await request.json();
      fileName = body?.fileName || '';
      base64 = body?.base64 || '';
      sourceUrl = body?.sourceUrl || '';

      if (!fileName) {
        return new Response(JSON.stringify({ error: '缺少 fileName' }), {
          status: 400,
          headers: {
            'content-type': 'application/json',
            ...corsHeaders,
          },
        });
      }
    }

    try {
      const existing = await r2Bucket.head(fileName);
      if (existing) {
        return new Response(JSON.stringify({ error: '文件已存在', exists: true }), {
          status: 409,
          headers: {
            'content-type': 'application/json',
            ...corsHeaders,
          },
        });
      }
    } catch {}

    let uploadData = fileData;
    let mimeType = 'audio/mpeg';

    if (!uploadData) {
      if (base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        uploadData = bytes.buffer;
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
                headers: {
                  'content-type': 'application/json',
                  ...corsHeaders,
                },
              },
            );
          }

          uploadData = await upstream.arrayBuffer();
          const contentTypeHeader = upstream.headers.get('content-type');
          if (contentTypeHeader) {
            mimeType = contentTypeHeader;
          }
        } catch (e) {
          return new Response(
            JSON.stringify({
              error: `下载源文件错误: ${e.message}`,
            }),
            {
              status: 502,
              headers: {
                'content-type': 'application/json',
                ...corsHeaders,
              },
            },
          );
        }
      } else {
        return new Response(JSON.stringify({ error: '缺少文件数据、base64 或 sourceUrl' }), {
          status: 400,
          headers: {
            'content-type': 'application/json',
            ...corsHeaders,
          },
        });
      }
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

    await r2Bucket.put(fileName, uploadData, {
      httpMetadata: {
        contentType: mimeType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    const rawUrl = `/api/r2?key=${encodeURIComponent(fileName)}`;
    return new Response(
      JSON.stringify({
        ok: true,
        rawUrl,
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          ...corsHeaders,
        },
      },
    );
  } catch (error) {
    console.error('[api/r2] POST 错误:', error);
    return new Response(
      JSON.stringify({
        error: 'R2 上传错误',
        message: error.message,
      }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
      },
    );
  }
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Range',
      'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges',
    },
  });
};
