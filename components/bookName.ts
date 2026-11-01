// The name of each entry's book, for its book mark: only when the user has two or more books, so one book looks as before.
export const withBookName = <T extends { book: { name: string } }>(items: T[], several: boolean): (T & { bookName?: string })[] =>
  items.map((i) => ({ ...i, bookName: several ? i.book.name : undefined }));
