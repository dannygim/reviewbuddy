import { createContext, useContext } from "react";

export type Reviewer = {
  nickname: string;
  clientId: string;
  /** The session has ended: no new comments or changes. */
  readOnly: boolean;
};

export const ReviewerContext = createContext<Reviewer>({
  nickname: "",
  clientId: "",
  readOnly: true,
});

export const useReviewer = () => useContext(ReviewerContext);
