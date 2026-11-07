/*
 * APC Inventario — generador de hojas PDF A4 sin servidor ni CDN.
 * Los QR se dibujan directamente como vectores PDF para conservar nitidez.
 * QRCode por Kazuhiko Arase, licencia MIT (módulo qr-core.js).
 */
import QRCode, { ErrorCorrectLevel } from './qr-core.js';

const PW = 595.276, PH = 841.890; // A4, puntos PDF
const NAVY = [23/255, 61/255, 99/255];
const ORANGE = [244/255, 124/255, 34/255];
const GREEN = [5/255, 151/255, 78/255];
const GREY = [114/255, 128/255, 141/255];
const WHITE = [1,1,1];

function byteString(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 255;
  return bytes;
}
function concatBytes(parts) {
  const length = parts.reduce((n,p)=>n+p.length,0);
  const out = new Uint8Array(length);
  let pos = 0;
  parts.forEach(p => { out.set(p,pos); pos += p.length; });
  return out;
}
function pdfEscape(raw) {
  // PDF Helvetica /WinAnsiEncoding admite estos caracteres latinos; evita emojis.
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u2013\u2014]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"')
    .replace(/[^\x20-\xff]/g,'?').replace(/[\\()]/g, c=>'\\'+c);
}
class PdfBuilder {
  constructor() { this.objects = []; }
  add(content='') { this.objects.push(content); return this.objects.length; }
  set(id,content) { this.objects[id-1] = content; }
  make(rootId) {
    const chunks = [byteString('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
    const offsets=[0];
    let offset=chunks[0].length;
    this.objects.forEach((obj,i)=>{
      offsets.push(offset);
      const chunk=byteString(`${i+1} 0 obj\n${obj}\nendobj\n`);
      chunks.push(chunk); offset+=chunk.length;
    });
    const xrefOffset=offset;
    const rows=[`xref\n0 ${this.objects.length+1}\n0000000000 65535 f \n`];
    for(let i=1;i<offsets.length;i++) rows.push(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
    rows.push(`trailer\n<< /Size ${this.objects.length+1} /Root ${rootId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    chunks.push(byteString(rows.join('')));
    return new Blob(chunks,{type:'application/pdf'});
  }
}
function rgb(color, stroke=false) { return `${color.map(v=>v.toFixed(4)).join(' ')} ${stroke ? 'RG' : 'rg'}\n`; }
function roundRect(x,y,w,h,r,fill=false,stroke=false) {
  const k=0.5522847498, p=r*k;
  const path=[`${(x+r).toFixed(2)} ${y.toFixed(2)} m`, `${(x+w-r).toFixed(2)} ${y.toFixed(2)} l`, `${(x+w-r+p).toFixed(2)} ${y.toFixed(2)} ${(x+w).toFixed(2)} ${(y+r-p).toFixed(2)} ${(x+w).toFixed(2)} ${(y+r).toFixed(2)} c`, `${(x+w).toFixed(2)} ${(y+h-r).toFixed(2)} l`, `${(x+w).toFixed(2)} ${(y+h-r+p).toFixed(2)} ${(x+w-r+p).toFixed(2)} ${(y+h).toFixed(2)} ${(x+w-r).toFixed(2)} ${(y+h).toFixed(2)} c`, `${(x+r).toFixed(2)} ${(y+h).toFixed(2)} l`, `${(x+r-p).toFixed(2)} ${(y+h).toFixed(2)} ${x.toFixed(2)} ${(y+h-r+p).toFixed(2)} ${x.toFixed(2)} ${(y+h-r).toFixed(2)} c`, `${x.toFixed(2)} ${(y+r).toFixed(2)} l`, `${x.toFixed(2)} ${(y+r-p).toFixed(2)} ${(x+r-p).toFixed(2)} ${y.toFixed(2)} ${(x+r).toFixed(2)} ${y.toFixed(2)} c`, 'h'];
  return `${path.join('\n')}\n${fill&&stroke?'B':fill?'f':stroke?'S':'n'}\n`;
}
function poly(points) { return `${points.map(([x,y],i)=>`${x.toFixed(2)} ${y.toFixed(2)} ${i?'l':'m'}`).join('\n')}\nh f\n`; }
function brandMark(cx, cy, scale=1) {
  const chevron=(y)=>[
    [cx, y+9*scale], [cx+10*scale,y-1*scale], [cx+10*scale,y-7*scale],
    [cx,y+3*scale], [cx-10*scale,y-7*scale], [cx-10*scale,y-1*scale]
  ];
  return rgb(GREEN)+poly(chevron(cy+5.4*scale))+rgb(ORANGE)+poly(chevron(cy-7*scale));
}
const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const measureContext = measureCanvas?.getContext('2d');
function approximateWidth(txt,size,bold=false) {
  if (measureContext) {
    measureContext.font = `${bold?'bold ':''}${size}px Arial, Helvetica, sans-serif`;
    return measureContext.measureText(txt).width;
  }
  return txt.length*size*.55;
}
function sizedText(txt,maxWidth,desired,min=5) {
  let size=desired;
  while(size>min && approximateWidth(txt,size,true)>maxWidth) size-=.3;
  return Math.max(min,size);
}
function drawText(txt,x,y,size,{bold=false,color=NAVY,align='left'}={}) {
  const width=approximateWidth(txt,size,bold);
  if(align==='center') x-=width/2;
  if(align==='right') x-=width;
  return rgb(color)+`BT /${bold?'F2':'F1'} ${size.toFixed(2)} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfEscape(txt)}) Tj ET\n`;
}
function qrMatrix(url) {
  const qr=new QRCode(0, ErrorCorrectLevel.M);
  qr.addData(url);
  qr.make();
  return qr;
}
function drawQr(matrix,x,y,size) {
  const n=matrix.getModuleCount(), quiet=4;
  const unit=size/(n+2*quiet);
  let s=rgb([0,0,0]);
  // Agrupa módulos vecinos para reducir el PDF y evitar líneas finas.
  for(let row=0;row<n;row++) {
    let c=0;
    while(c<n) {
      if(!matrix.isDark(row,c)) { c++; continue; }
      const start=c;
      while(c<n && matrix.isDark(row,c)) c++;
      const px=x+(start+quiet)*unit, py=y+(n-row+quiet-1)*unit;
      s+=`${px.toFixed(3)} ${py.toFixed(3)} ${((c-start)*unit+.005).toFixed(3)} ${(unit+.005).toFixed(3)} re f\n`;
    }
  }
  return s;
}
function layoutFor(perPage) {
  const configs={1:[1,1],2:[1,2],4:[2,2],6:[2,3]};
  const [columns,rows]=configs[perPage]||configs[4];
  const marginX=20,marginY=22,gapX=12,gapY=12;
  return {columns,rows,gapX,gapY,marginX,marginY,
    width:(PW-2*marginX-(columns-1)*gapX)/columns,
    height:(PH-2*marginY-(rows-1)*gapY)/rows};
}
function drawLabel(container,x,y,w,h,perPage) {
  const {name, url}=container;
  const tight=perPage===6;
  const mid=x+w/2, top=y+h;
  const edge=tight?2.5:3;
  let p=rgb(NAVY,true)+`${edge} w\n`+roundRect(x+1.5,y+1.5,w-3,h-3,tight?17:20,false,true);
  // Cabecera de APC, repetida con el mismo diseño en todas las etiquetas.
  const brandY=top-(tight?25:32);
  const headerSize=tight?10.2:12;
  const title='APC CORPORACIÓN';
  const titleWidth=approximateWidth(title,headerSize,true);
  const brandStart=mid-(titleWidth+34)/2;
  p+=brandMark(brandStart+10,brandY-3,tight?.75:.95);
  p+=drawText(title,brandStart+29,brandY,headerSize,{bold:true});
  p+=drawText('Inventario de suministros',brandStart+29,brandY-(tight?11:14),tight?6.8:7.5,{color:GREY});

  // Banda naranja e instrucción, idénticas para cada recipiente.
  const barH=tight?30:38;
  const barY=y+(tight?24:33);
  const barX=x+w*(tight?.11:.12),barW=w*(tight?.78:.76);
  p+=rgb(ORANGE)+roundRect(barX,barY,barW,barH,tight?10:13,true,false);
  const cleanName=String(name||'RECIPIENTE').toUpperCase();
  const titleFont=sizedText(cleanName,barW-12,tight?15.7:21,9);
  p+=drawText(cleanName,mid,barY+(barH-titleFont)/2+3,titleFont,{bold:true,color:WHITE,align:'center'});
  const footer='ESCANEAR PARA ACTUALIZAR INVENTARIO';
  const footerFont=sizedText(footer,w-24,tight?7:8.7,6);
  p+=drawText(footer,mid,y+(tight?11:16),footerFont,{bold:true,align:'center'});

  // QR en vectores: alto contraste, zona silenciosa de 4 módulos.
  const availableBottom=barY+barH+(tight?4:10);
  const availableTop=top-(tight?44:53);
  const maxByHeight=availableTop-availableBottom;
  const maxByWidth=w-(tight?44:54);
  const side=Math.min(maxByWidth,maxByHeight,perPage===1?345:perPage===2?245:1000);
  if(side<80) throw new Error('La etiqueta es demasiado pequeña para imprimir un QR legible.');
  const qrY=availableBottom+(maxByHeight-side)/2;
  p+=drawQr(qrMatrix(url),mid-side/2,qrY,side);
  return p;
}

/**
 * @param {{name:string,url:string}[]} items QR existentes y con sus enlaces.
 * @param {1|2|4|6} perPage Cantidad de etiquetas en una hoja A4.
 * @returns {Blob} PDF listo para descargar.
 */
export function createQrPdf(items,perPage=4) {
  if(!items?.length) throw new Error('Selecciona al menos un QR.');
  if(![1,2,4,6].includes(Number(perPage))) throw new Error('Cantidad por hoja no válida.');
  const pdf = new PdfBuilder();
  const catalog=pdf.add(),pagesRef=pdf.add();
  const regular=pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold=pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageRefs=[];
  const grid=layoutFor(perPage);
  for (let start=0;start<items.length;start+=perPage) {
    let content='q\n';
    items.slice(start,start+perPage).forEach((item,index)=>{
      const col=index%grid.columns,row=Math.floor(index/grid.columns);
      const x=grid.marginX+col*(grid.width+grid.gapX);
      const y=PH-grid.marginY-(row+1)*grid.height-row*grid.gapY;
      content+=drawLabel(item,x,y,grid.width,grid.height,perPage);
    });
    content+='Q\n';
    const length=byteString(content).length;
    const stream=pdf.add(`<< /Length ${length} >>\nstream\n${content}endstream`);
    const page=pdf.add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${stream} 0 R >>`);
    pageRefs.push(page);
  }
  pdf.set(pagesRef,`<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map(id=>id+' 0 R').join(' ')}] >>`);
  pdf.set(catalog,`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
  return pdf.make(catalog);
}
