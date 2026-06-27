import { CampaignPrintImage, CampaignRecord } from '@flowiq/shared';
import { appendCampaignPrintImages } from './campaignApi';
import { uploadCampaignImage } from './campaignImageApi';

function toFileBaseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '');
}

async function loadPdfJsRuntime() {
  const pdfjs = await (new Function("return import('/pdf.min.mjs')")() as Promise<any>);
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  return pdfjs;
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType = 'image/png', quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Unable to render artwork image'));
      },
      mimeType,
      quality,
    );
  });
}

function buildArtworkPageFileName(fileName: string, pageNumber: number, totalPages: number) {
  const baseName = toFileBaseName(fileName);
  if (totalPages <= 1) return `${baseName}.png`;
  const digits = Math.max(2, String(totalPages).length);
  return `${baseName}-page-${String(pageNumber).padStart(digits, '0')}.png`;
}

function buildArtworkThumbnailFileName(fileName: string, pageNumber: number, totalPages: number) {
  const baseName = toFileBaseName(fileName);
  if (totalPages <= 1) return `${baseName}.thumb.webp`;
  const digits = Math.max(2, String(totalPages).length);
  return `${baseName}-page-${String(pageNumber).padStart(digits, '0')}.thumb.webp`;
}

async function convertPdfToArtworkPages(pdfFile: File, uploadMaxWidth = 2400, thumbnailMaxWidth = 320) {
  const pdfjs = await loadPdfJsRuntime();
  const objectUrl = URL.createObjectURL(pdfFile);
  try {
    const loadingTask = pdfjs.getDocument({ url: objectUrl });
    const pdf = await loadingTask.promise;
    const totalPages = Number(pdf.numPages ?? 0);
    const pages: Array<{ file: File; thumbnailFile: File; pageNumber: number; totalPages: number }> = [];

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const uploadScale = Math.min(1, uploadMaxWidth / Math.max(baseViewport.width, 1));
      const uploadViewport = page.getViewport({ scale: uploadScale });
      const uploadCanvas = document.createElement('canvas');
      uploadCanvas.width = Math.max(1, Math.ceil(uploadViewport.width));
      uploadCanvas.height = Math.max(1, Math.ceil(uploadViewport.height));
      const uploadContext = uploadCanvas.getContext('2d');
      if (!uploadContext) throw new Error('Unable to prepare artwork upload');
      await page.render({ canvasContext: uploadContext, viewport: uploadViewport }).promise;
      const uploadBlob = await canvasToBlob(uploadCanvas);
      const uploadFile = new File([uploadBlob], buildArtworkPageFileName(pdfFile.name, pageNumber, totalPages), { type: 'image/png' });

      const thumbnailScale = Math.min(1, thumbnailMaxWidth / Math.max(uploadCanvas.width, 1));
      const thumbnailCanvas = document.createElement('canvas');
      thumbnailCanvas.width = Math.max(1, Math.ceil(uploadCanvas.width * thumbnailScale));
      thumbnailCanvas.height = Math.max(1, Math.ceil(uploadCanvas.height * thumbnailScale));
      const thumbnailContext = thumbnailCanvas.getContext('2d');
      if (!thumbnailContext) throw new Error('Unable to prepare artwork thumbnail');
      thumbnailContext.drawImage(uploadCanvas, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
      const thumbnailBlob = await canvasToBlob(thumbnailCanvas, 'image/webp', 0.7);
      const thumbnailFile = new File(
        [thumbnailBlob],
        buildArtworkThumbnailFileName(pdfFile.name, pageNumber, totalPages),
        { type: 'image/webp' },
      );

      pages.push({ file: uploadFile, thumbnailFile, pageNumber, totalPages });
    }
    return pages;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function processArtworkPdf(
  campaignId: string,
  tenantId: string | null | undefined,
  pdfFile: File,
): Promise<{ campaign: CampaignRecord; images: CampaignPrintImage[] }> {
  const sourcePdfUpload = await uploadCampaignImage(pdfFile);
  const pageImages = await convertPdfToArtworkPages(pdfFile);
  const uploadedImages: CampaignPrintImage[] = [];

  for (const pageImage of pageImages) {
    const [uploadResponse, thumbnailUploadResponse] = await Promise.all([
      uploadCampaignImage(pageImage.file),
      uploadCampaignImage(pageImage.thumbnailFile),
    ]);
    const baseName = toFileBaseName(pdfFile.name) || 'Artwork';
    const imageName = pageImage.totalPages > 1 ? `${baseName} (Page ${pageImage.pageNumber})` : baseName;
    uploadedImages.push({
      id: uploadResponse.storedName,
      name: imageName,
      fileName: uploadResponse.originalName || pageImage.file.name,
      mimeType: uploadResponse.mimeType || pageImage.file.type || 'image/png',
      storedName: uploadResponse.storedName,
      imageUrl: uploadResponse.url || `/api/campaign-images/${uploadResponse.storedName}`,
      thumbnailFileName: thumbnailUploadResponse.originalName || pageImage.thumbnailFile.name,
      thumbnailStoredName: thumbnailUploadResponse.storedName,
      thumbnailUrl: thumbnailUploadResponse.url || `/api/campaign-images/${thumbnailUploadResponse.storedName}`,
      sourcePdfFileName: sourcePdfUpload.originalName || pdfFile.name,
      sourcePdfStoredName: sourcePdfUpload.storedName,
      sourcePdfUrl: sourcePdfUpload.url || `/api/campaign-images/${sourcePdfUpload.storedName}`,
    });
  }

  if (uploadedImages.length === 0) throw new Error('The PDF did not contain any uploadable pages.');
  const response = await appendCampaignPrintImages(campaignId, uploadedImages, tenantId);
  return { campaign: response.campaign, images: uploadedImages };
}
