import { createContext, useContext } from "react";

export type Reviewer = {
  nickname: string;
  clientId: string;
  /** The session has ended: no new comments or changes. */
  readOnly: boolean;
  /** This browser is the owner's (docs/adr/0009-owner-by-connection.md). */
  owner: boolean;
};

export const ReviewerContext = createContext<Reviewer>({
  nickname: "",
  clientId: "",
  readOnly: true,
  owner: false,
});

export const useReviewer = () => useContext(ReviewerContext);
