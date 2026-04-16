const SUPPORTED_EXTENSIONS = new Set(['txt', 'md', 'pdf']);

export function isSupportedFile(file: File): boolean {
  const extension = getFileExtension(file.name);
  return SUPPORTED_EXTENSIONS.has(extension);
}

export function getFileExtension(filename: string): string {
  const pieces = filename.toLowerCase().split('.');
  return pieces.length > 1 ? pieces[pieces.length - 1] : '';
}

export async function toBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';

  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return window.btoa(binary);
}
