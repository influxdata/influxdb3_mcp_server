import { readFileSync, existsSync, readdirSync } from "fs";
import { join, extname, basename } from "path";

export interface ContextFileInfo {
  path: string;
  name: string;
  extension: string;
  content: string;
  exists: boolean;
}

export class ContextFileService {
  private workingDirectory: string;

  constructor(workingDirectory: string = process.cwd()) {
    this.workingDirectory = workingDirectory;
  }

  async loadContextFile(): Promise<ContextFileInfo | null> {
    try {
      const contextFolderPath = join(this.workingDirectory, "context");
      const contextFolderFile = this.searchInContextFolder(contextFolderPath);

      if (contextFolderFile) {
        return contextFolderFile;
      }

      const contextNamedFile = this.searchForContextNamedFiles();

      return contextNamedFile;
    } catch (error: any) {
      console.error("Error loading context file:", error.message);
      return null;
    }
  }

  private searchInContextFolder(
    contextFolderPath: string,
  ): ContextFileInfo | null {
    if (!existsSync(contextFolderPath)) {
      return null;
    }

    try {
      const files = readdirSync(contextFolderPath);
      const validExtensions = [".json", ".txt", ".md"];

      for (const file of files) {
        const filePath = join(contextFolderPath, file);
        const ext = extname(file).toLowerCase();

        if (validExtensions.includes(ext)) {
          const content = readFileSync(filePath, "utf-8");
          return {
            path: filePath,
            name: basename(file, ext),
            extension: ext.substring(1),
            content,
            exists: true,
          };
        }
      }
    } catch (error: any) {
      console.error("Error reading context folder:", error.message);
    }

    return null;
  }

  private searchForContextNamedFiles(): ContextFileInfo | null {
    try {
      const files = readdirSync(this.workingDirectory);
      const validExtensions = [".json", ".txt", ".md"];

      const contextFiles = files.filter((file) => {
        const ext = extname(file).toLowerCase();
        const nameWithoutExt = basename(file, ext).toLowerCase();
        return (
          validExtensions.includes(ext) && nameWithoutExt.includes("context")
        );
      });

      if (contextFiles.length === 0) {
        return null;
      }

      const file = contextFiles[0];
      const filePath = join(this.workingDirectory, file);
      const ext = extname(file).toLowerCase();
      const content = readFileSync(filePath, "utf-8");

      return {
        path: filePath,
        name: basename(file, ext),
        extension: ext.substring(1),
        content,
        exists: true,
      };
    } catch (error: any) {
      console.error("Error searching for context files:", error.message);
      return null;
    }
  }
}
