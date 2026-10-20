import { getNodesBounds, type Node } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { invoke } from '@tauri-apps/api/core';
import { desktop } from './api';

export async function exportDiagram(viewport: HTMLElement, nodes: Node[], format: 'png' | 'pdf', name: string, background: string) {
  await document.fonts.ready;
  const elements = [...viewport.querySelectorAll<HTMLElement>('.react-flow__node')];
  const measured = nodes.map(node => {
    const element = elements.find(element => element.dataset.id === node.id);
    return element ? { ...node, measured: { width: element.offsetWidth, height: element.offsetHeight } } : node;
  });
  const bounds = getNodesBounds(measured);
  for (const edge of viewport.querySelectorAll<SVGGraphicsElement>('.react-flow__edge')) {
    const box = edge.getBBox();
    const right = Math.max(bounds.x + bounds.width, box.x + box.width), bottom = Math.max(bounds.y + bounds.height, box.y + box.height);
    bounds.x = Math.min(bounds.x, box.x); bounds.y = Math.min(bounds.y, box.y);
    bounds.width = right - bounds.x; bounds.height = bottom - bounds.y;
  }
  const padding = 100;
  const naturalWidth = Math.max(400, bounds.width + padding * 2), naturalHeight = Math.max(300, bounds.height + padding * 2);
  const scale = Math.min(1, 8000 / naturalWidth, 8000 / naturalHeight, Math.sqrt(16_000_000 / (naturalWidth * naturalHeight)));
  const width = Math.ceil(naturalWidth * scale), height = Math.ceil(naturalHeight * scale);
  const image = await toPng(viewport, {
    backgroundColor: background, width, height, pixelRatio: 1, skipFonts: true,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${(padding - bounds.x) * scale}px, ${(padding - bounds.y) * scale}px) scale(${scale})` },
    filter: node => !(node instanceof Element && (node.classList.contains('react-flow__handle') || node.classList.contains('react-flow__edgeupdater'))),
  });
  let bytes: Uint8Array;
  if (format === 'pdf') {
    const pdf = new jsPDF({ orientation: width >= height ? 'landscape' : 'portrait', unit: 'pt', format: [width, height], compress: true });
    pdf.addImage(image, 'PNG', 0, 0, width, height);
    bytes = new Uint8Array(pdf.output('arraybuffer'));
  } else {
    const binary = atob(image.split(',')[1]);
    bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  }
  if (desktop) return invoke<boolean>('save_erd_export', { name, format, bytes: Array.from(bytes) });
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: format === 'png' ? 'image/png' : 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `${name.replace(/[^\p{L}\p{N}_-]/gu, '_')}.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
