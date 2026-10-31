import os

import sentencepiece

from . import vsr


class Tok:
    def __init__(self, token_list):
        self.sp = sentencepiece.SentencePieceProcessor(model_file=os.path.join(vsr.MODELS, "lm", "unigram5000.model"))
        self.ids = {token: index for index, token in enumerate(token_list)}

    def __call__(self, text):
        return [self.ids.get(piece, self.ids["<unk>"]) for piece in self.sp.encode(text, out_type=str)]
