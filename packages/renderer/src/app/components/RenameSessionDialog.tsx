import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import type { Session } from "@app/core";
import { useDataMutations } from "../../lib/data/DataProvider.js";

/** Single-field dialog to rename a session. */
export function RenameSessionDialog({ session, onOpenChange }: {
  session: Session | null;
  onOpenChange: (open: boolean) => void;
}) {
  const mutations = useDataMutations();
  const [title, setTitle] = useState("");

  useEffect(() => { if (session) setTitle(session.title); }, [session]);

  const submit = async () => {
    const t = title.trim();
    if (!session || !t || t === session.title) { onOpenChange(false); return; }
    await mutations.renameSession(session.id, t);
    onOpenChange(false);
  };

  return (
    <Dialog open={!!session} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename session</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 pt-2">
          <Label htmlFor="rename-session">Title</Label>
          <Input
            id="rename-session"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
        </div>
        <DialogFooter className="mt-5">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!title.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
