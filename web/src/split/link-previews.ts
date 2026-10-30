import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';

/** What Google says a Maps link in notes is: shared by its card, its name in the text and the form */
export const linkPreviewQuery = (url: string) =>
  queryOptions({
    queryKey: ['link-preview', url],
    queryFn: () => api.linkPreview(url),
    // A place's name and address don't change while the app is open
    staleTime: Infinity,
    retry: 1,
  });
