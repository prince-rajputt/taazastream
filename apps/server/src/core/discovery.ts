import { Bonjour, type Service } from 'bonjour-service';
import makeMdns from 'multicast-dns';
import type { Logger } from 'pino';
import { lanAddresses } from './system';

/**
 * Optional LAN discovery:
 *  - answers mDNS A-record queries for `<hostname>.local` (e.g. http://taazastream.local:3000)
 *  - advertises an `_http._tcp` Bonjour service named after the server
 *
 * This is a convenience only. The guaranteed way to connect is http://SERVER-IP:PORT,
 * because some phones/TVs (notably older Android) do not resolve .local names.
 */
export class Discovery {
  private mdns: ReturnType<typeof makeMdns> | null = null;
  private bonjour: Bonjour | null = null;
  private service: Service | null = null;
  hostname: string | null = null;

  constructor(private readonly log: Logger) {}

  start(opts: { hostname: string; port: number; name: string }) {
    this.stop();
    const fqdn = `${opts.hostname}.local`;
    try {
      this.mdns = makeMdns({ reuseAddr: true });
      this.mdns.on('query', (query) => {
        const wants = query.questions.some(
          (q) => q.name.toLowerCase() === fqdn && (q.type === 'A' || (q.type as string) === 'ANY'),
        );
        if (!wants) return;
        const ips = lanAddresses();
        if (!ips.length) return;
        this.mdns?.respond({
          answers: ips
            .slice(0, 2)
            .map((ip) => ({ name: fqdn, type: 'A' as const, ttl: 120, data: ip })),
        });
      });
      this.mdns.on('error', (err: Error) =>
        this.log.warn({ err: err.message }, 'mDNS responder error'),
      );
      this.hostname = fqdn;
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'mDNS responder unavailable');
      this.mdns = null;
    }
    try {
      this.bonjour = new Bonjour({}, (err: Error) =>
        this.log.warn({ err: err.message }, 'Bonjour error'),
      );
      this.service = this.bonjour.publish({
        name: opts.name.slice(0, 60),
        type: 'http',
        port: opts.port,
        host: fqdn,
        txt: { path: '/', app: 'taazastream' },
      });
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'Bonjour advertisement unavailable');
    }
    this.log.info({ host: fqdn, port: opts.port }, 'LAN discovery (mDNS) enabled');
  }

  stop() {
    try {
      this.service?.stop?.();
      this.bonjour?.destroy();
    } catch {
      /* ignore */
    }
    try {
      this.mdns?.destroy();
    } catch {
      /* ignore */
    }
    this.service = null;
    this.bonjour = null;
    this.mdns = null;
    this.hostname = null;
  }
}
