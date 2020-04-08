import { net } from 'electron';

const promiseMap: Record<string, Promise<string>> = {};

const hostIpMap = (function(): Record<string, string> {
  const rules = getHostResolverRules();
  const hostIpMap: Record<string, string> = {};
  if (rules) {
    rules.split(/\s*,\s*/).forEach(function(item): void {
      const pair = item
        .trim()
        .replace(/^MAP /, '')
        .split(/\s+/);
      if (pair[0] && pair[1]) {
        hostIpMap[pair[0]] = pair[1];
      }
    });
  }
  return hostIpMap;
})();

export type HostResolverConfig = {
  hostnames: Array<string>;
  resolver: (hostname: string) => string;
  timeout?: number;
};

let CONFIG: HostResolverConfig;

export function configHostResolver(conf: HostResolverConfig): void {
  if (typeof conf.resolver !== 'function') {
    throw new Error('resolver function is missing!');
  }

  if (!Array.isArray(conf.hostnames)) {
    throw new Error('hostnames array is missing!');
  }

  CONFIG = conf;
  CONFIG.timeout = CONFIG.timeout > 0 ? CONFIG.timeout : 3000;
}

export function resolveHostname(hostname: string): Promise<string> {
  if (!CONFIG) {
    throw new Error('please config first!');
  }

  if (!promiseMap[hostname]) {
    promiseMap[hostname] = new Promise(function(resolve): void {
      if (hostIpMap[hostname]) {
        resolve(hostIpMap[hostname]);
        return;
      }
      let resolved = false;
      const req = net.request({
        url: 'https://' + hostname,
        method: 'HEAD',
      });
      req.on('redirect', function(): void {
        resolve(hostname);
        resolved = true;
      });
      req.on('response', function(): void {
        resolve(hostname);
        resolved = true;
      });
      req.on('error', function(): void {
        resolved = false;
      });
      req.on('close', callback);
      req.end();
      const toRef = setTimeout(callback, CONFIG.timeout);
      function callback(): void {
        clearTimeout(toRef);
        if (!resolved) {
          const dnsReq = net.request(CONFIG.resolver(hostname));
          dnsReq.on('response', function(res) {
            const chunk: Array<Buffer> = [];
            let size = 0;
            res.on('data', function(data): void {
              chunk.push(data);
              size += data.length;
            });
            res.on('end', function(): void {
              try {
                const data = JSON.parse(Buffer.concat(chunk, size).toString());
                if (data.ips[0]) {
                  hostIpMap[hostname] = data.ips[0];
                  resolve(data.ips[0]);
                } else {
                  resolve(hostname);
                }
              } catch (err) {
                promiseMap[hostname] = null;
                resolve(hostname);
              }
            });
            res.on('aborted', function(): void {
              promiseMap[hostname] = null;
              resolve(hostname);
            });
            res.on('error', function(): void {
              promiseMap[hostname] = null;
              resolve(hostname);
            });
          });
          dnsReq.on('error', function(): void {
            promiseMap[hostname] = null;
            resolve(hostname);
          });
          dnsReq.end();
        }
      }
    });
  }
  return promiseMap[hostname];
}

export function resolveHostnameSync(hostname: string): string {
  return hostIpMap[hostname] || hostname;
}

export function resolveAllHostnames(): Promise<string[][]> {
  if (!CONFIG) {
    throw new Error('please config first!');
  }
  return Promise.all(
    CONFIG.hostnames.map(function(hostname: string): Promise<string[]> {
      return resolveHostname(hostname).then(function(res: string): string[] {
        return [hostname, res];
      });
    }),
  );
}

export function getHostResolverRules(): string {
  const hostRulesIndex = process.argv.indexOf('--host-resolver-rules');
  if (hostRulesIndex !== -1) {
    return process.argv[hostRulesIndex + 1] || '';
  }
  return '';
}
