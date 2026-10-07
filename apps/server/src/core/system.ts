import { statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DiskInfo } from '@taazastream/shared';

/** Interfaces that are usually virtual adapters and not reachable from phones/TVs. */
const VIRTUAL_IFACE = /vethernet|virtualbox|vmware|vbox|hyper-v|wsl|docker|loopback|tailscale|zerotier|hamachi|npcap|bluetooth|tap|tun|utun|br-|virbr|veth/i;

function isPrivateV4(ip: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

/** LAN IPv4 addresses ordered by likelihood of being the one other devices can reach. */
export function lanAddresses(): string[] {
  const out: { ip: string; score: number }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue; // APIPA: no DHCP
      let score = 0;
      if (isPrivateV4(a.address)) score += 10;
      if (a.address.startsWith('192.168.')) score += 3;
      if (/wi-?fi|wlan|wireless|ethernet|^eth|^en/i.test(name)) score += 5;
      if (VIRTUAL_IFACE.test(name)) score -= 20;
      out.push({ ip: a.address, score });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.ip);
}

/** Whether a request IP belongs to a private/LAN range (or loopback). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.replace(/^::ffff:/, '');
  if (v === '127.0.0.1' || v === '::1' || v.startsWith('127.')) return true;
  if (isPrivateV4(v)) return true;
  if (v.startsWith('169.254.')) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v)) return true; // CGNAT / Tailscale
  if (/^f[cd][0-9a-f]{2}:/i.test(v) || /^fe80:/i.test(v)) return true; // IPv6 ULA / link-local
  return false;
}

export function isLoopback(ip: string): boolean {
  const v = ip.replace(/^::ffff:/, '');
  return v === '::1' || v.startsWith('127.');
}

/** CPU usage sampled between calls (percentage over the last interval). */
export class CpuMeter {
  private last = this.snapshot();
  private value = 0;
  private timer: NodeJS.Timeout | null = null;

  private snapshot() {
    let idle = 0;
    let total = 0;
    for (const c of os.cpus()) {
      const t = c.times;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    return { idle, total };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.sample(), 2_000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private sample() {
    const now = this.snapshot();
    const idle = now.idle - this.last.idle;
    const total = now.total - this.last.total;
    this.last = now;
    if (total > 0) this.value = Math.max(0, Math.min(100, 100 * (1 - idle / total)));
  }

  get percent(): number {
    return Math.round(this.value * 10) / 10;
  }
}

/** Disk usage for the volumes holding the given paths (de-duplicated per volume). */
export async function diskUsage(paths: { path: string; label: string }[]): Promise<DiskInfo[]> {
  const seen = new Map<string, DiskInfo>();
  for (const p of paths) {
    try {
      const st = await statfs(p.path);
      const total = Number(st.blocks) * Number(st.bsize);
      const free = Number(st.bavail) * Number(st.bsize);
      const volume = process.platform === 'win32' ? path.parse(path.resolve(p.path)).root.toUpperCase() : `${total}-${free}`;
      if (seen.has(volume)) continue;
      seen.set(volume, {
        path: process.platform === 'win32' ? volume : p.path,
        label: p.label,
        totalBytes: total,
        freeBytes: free,
        usedBytes: total - free,
      });
    } catch {
      /* drive offline */
    }
  }
  return [...seen.values()];
}
