# Next.js Pixel Editor

This project is a Next.js application designed for easy deployment on Vercel.

## Deployment to Vercel

To deploy this project to Vercel, follow these steps:

1.  **Push to GitHub/GitLab/Bitbucket:** Ensure this code is in a repository on one of these platforms.
2.  **Import to Vercel:**
    *   Go to [Vercel](https://vercel.com).
    *   Click "New Project".
    *   Import your repository.
3.  **Configure:**
    *   Vercel should automatically detect Next.js.
    *   The build command is set to `npm run build`.
    *   The install command is `npm install`.
4.  **Deploy:** Click "Deploy".

## Local Development

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Run the development server:
    ```bash
    npm run dev
    ```
3.  Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Features

- Next.js 15+
- Tailwind CSS 4
- Shadcn UI
- ONNX Runtime Web for SAM (Segment Anything Model) support
