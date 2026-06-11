declare module 'gif.js' {
  interface GIFOptions {
    workers?: number;
    quality?: number;
    width?: number;
    height?: number;
    workerScript?: string;
    repeat?: number;
    background?: string;
    dither?: string | boolean;
    transparent?: string | null;
  }

  interface AddFrameOptions {
    copy?: boolean;
    delay?: number;
    dispose?: number;
  }

  class GIF {
    constructor(options: GIFOptions);
    addFrame(imageData: CanvasRenderingContext2D | HTMLCanvasElement | ImageData, options?: AddFrameOptions): this;
    on(event: 'progress', callback: (progress: number) => void): this;
    on(event: 'finished', callback: (blob: Blob) => void): this;
    on(event: 'start', callback: () => void): this;
    on(event: 'abort', callback: () => void): this;
    render(): this;
    abort(): this;
    running: boolean;
  }

  export default GIF;
}
