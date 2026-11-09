/**
 * 발표용 미리보기 (웹 화면만, 11/8 재웅 승인). 미뤄 둔 두 아이디어를 실제 기능 없이 장면으로만 보여 준다.
 * 장면 글은 여기, 그림은 pages/Showcase.tsx. 이름은 가짜(민지·준호)이고 학번·전화번호는 넣지 않는다
 */
export type StoryId = 'lawyer' | 'harvest'

export interface Scene {
  /** 장면 위 시각 */
  time: string
  /** 한 줄 설명 (발표 자막) */
  caption: string
}

export interface Story {
  id: StoryId
  title: string
  pitch: string
  /** 이 아이디어에서 AI가 하는 일 한 줄 (규칙과 구분) */
  aiPart: string
  scenes: Scene[]
}

export const STORIES: Story[] = [
  {
    id: 'lawyer',
    title: '학생 편 변호사',
    pitch: '억울한 경고가 생기면 비서가 먼저 기록을 뒤져 학생 편에서 근거를 모아요.',
    aiPart: 'AI는 기록을 읽고 해명 초안을 써요. 무르기·판정은 규칙과 관리자가 해요.',
    scenes: [
      { time: '15:02', caption: '민지는 제때 왔지만, 앞사람이 번호를 5번 틀려 문이 1분 잠겼어요' },
      { time: '15:20', caption: '노쇼 경고보다 비서 알림이 먼저 와요. 기록에서 근거를 찾았대요' },
      { time: '15:21', caption: '기록이 확실한 건 규칙이 바로 물러요. 민지는 아무것도 안 했어요' },
      { time: '18:40', caption: '다른 날 준호. 애매한 건이라 비서가 해명 초안만 써 뒀어요' },
      { time: '18:52', caption: '관리자에게는 근거가 붙은 애매한 건만 가요. 판정은 사람이 해요' },
    ],
  },
  {
    id: 'harvest',
    title: '답 못 한 질문 수확',
    pitch: '비서가 답 못 한 질문을 모아 교학팀에 한 번에 묻고, 답을 다음 학생에게 돌려줘요.',
    aiPart: 'AI는 비슷한 질문을 묶고, 교학팀 한 줄 답을 근거로 다시 답해요.',
    scenes: [
      { time: '화 21:40', caption: '규칙에 없는 질문이 와요. 비서는 지어내지 않고 "물어 둘게요"' },
      { time: '금 16:00', caption: '한 주 동안 모인 질문을 비슷한 것끼리 묶어 교학팀에 먼저 청해요' },
      { time: '금 16:02', caption: '교학팀은 한 줄만 적으면 돼요' },
      { time: '금 16:03', caption: '물었던 학생들에게 답이 먼저 가요' },
      { time: '다음 주 14:20', caption: '다음 학생부터는 교학팀 답을 근거로 바로 답해요' },
    ],
  },
]

/** 장면 한 칸 머무는 시간 */
export const SCENE_MS = 5200

export const storyById = (id: string | null): Story => STORIES.find((s) => s.id === id) ?? STORIES[0]

/** 다음·앞 장면 번호 (끝에서 넘기면 처음으로) */
export const step = (i: number, n: number, dir: 1 | -1) => (i + dir + n) % n
