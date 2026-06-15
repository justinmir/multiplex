import { Session, PullRequest, Reference } from "../data/mockData";
import { SessionDetail } from "./SessionDetail";

interface Props {
  session: Session;
  prs: PullRequest[];
  onAddReference: (r: Reference) => void;
  onClose: () => void;
}

export function TaskView({ session, prs, onAddReference, onClose }: Props) {
  return (
    <SessionDetail
      backLabel="Home"
      session={session}
      prs={prs}
      references={session.references ?? []}
      onAddReference={onAddReference}
      onClose={onClose}
    />
  );
}
