import { copy } from "@/components/copy";
import { Upload } from "@/components/Upload";

export const metadata = { title: copy.uploadTitle };

// Where Claude sends the user to keep files (inbox, action upload): picked here, they wait under Prüfen like any share.
export default function UploadPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">{copy.uploadTitle}</h1>
      <p className="text-sm text-muted">{copy.uploadHint}</p>
      <Upload />
    </div>
  );
}
