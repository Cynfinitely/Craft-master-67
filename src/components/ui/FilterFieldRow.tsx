export function FilterFieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center [&>*]:min-w-0">
      {children}
    </div>
  );
}
