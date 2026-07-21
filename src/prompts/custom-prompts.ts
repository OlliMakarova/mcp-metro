import { IPromptData, IGetPromptRequest } from 'fa-mcp-sdk';

export const customPrompts: IPromptData[] = [
  {
    name: 'custom_prompt',
    // `title` and `icons` are optional (standard §10.5, MAY). They are shown only in the client UI;
    // omit them and the prompt still works. Icons accept an absolute URL or an inlined data: URI.
    title: 'Custom prompt',
    icons: [{ src: 'https://example.com/icons/custom-prompt.png', mimeType: 'image/png', sizes: ['48x48'] }],
    description: 'Custom prompt',
    arguments: [],
    content: (request: IGetPromptRequest) => {
      return `Custom prompt content ${request.method}`;
    },
  },
];
