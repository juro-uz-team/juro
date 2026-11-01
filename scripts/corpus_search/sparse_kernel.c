#include <stdint.h>
#include <stddef.h>
#include <math.h>
#define MAXIMUM 9007199254740991ULL
#ifdef _WIN32
#define API __declspec(dllexport)
#else
#define API
#endif
API int sparse_kernel_version(void) { return 1; }
static int read_value(const uint8_t *raw, size_t length, size_t *at, uint64_t *value) {
  *value=0; unsigned shift=0;
  while (*at<length) {
    uint8_t byte=raw[(*at)++];
    if (shift>49) return 1;
    *value|=((uint64_t)(byte&127))<<shift;
    if (*value>MAXIMUM) return 1;
    if (!(byte&128)) return shift && byte==0;
    shift+=7;
  }
  return 1;
}
API int accumulate(const uint8_t *raw,size_t length,uint64_t rows,uint64_t frequency,
 const uint64_t *metadata,uint64_t count,const double *averages,const double *coefficients,
 double *scores,int64_t *last,int compensated) {
  if(!raw||!metadata||!averages||!coefficients||!scores||!last||!count||rows>1024) return 9;
  size_t at=0; int64_t previous=-1; uint64_t weights=0;
  for (uint64_t row=0;row<rows;row++) {
    uint64_t values[6];
    for (unsigned field=0;field<6;field++) if(read_value(raw,length,&at,&values[field])) return 1;
    if (!values[0]||!values[1]||!(values[2]|values[3]|values[4]|values[5])) return 2;
    uint64_t ordinal=(uint64_t)(previous+1)+values[0]-1;
    if(ordinal>=count||ordinal>MAXIMUM||(int64_t)ordinal<=*last) return 3;
    previous=*last=(int64_t)ordinal;
    const uint64_t *entry=metadata+ordinal*7;
    if(entry[2]!=values[1]) return 4;
    weights+=values[1]; if(weights>MAXIMUM) return 5;
    double contribution=0,correction=0;
    for(unsigned field=0;field<4;field++) {
      uint64_t frequency_value=values[field+2],field_length=entry[field+3];
      if(frequency_value>field_length) return 6;
      double tf=(double)frequency_value,length_value=(double)field_length;
      double term=tf>0?coefficients[field]*(tf*2.2)/(tf+1.2*(.25+.75*length_value/averages[field])):0.0;
      double next=contribution+term;
      if(compensated) correction+=fabs(contribution)>=fabs(term)?(contribution-next)+term:(term-next)+contribution;
      contribution=next;
    }
    if(correction&&isfinite(correction)) contribution+=correction;
    if(scores[ordinal]<0) scores[ordinal]=0;
    scores[ordinal]+=contribution;
    if(!isfinite(scores[ordinal])) return 7;
  }
  return at!=length||weights!=frequency?8:0;
}
/* Stable top-k; equal scores prefer the smaller ordinal, as the scalar reader. */
API size_t select_best(const double *scores,uint64_t count,uint64_t start,uint64_t *ids,double *best,size_t capacity,size_t filled) {
  if(!scores||!ids||!best||!capacity||capacity>50||filled>capacity) return 0;
  for(uint64_t ordinal=start;ordinal<count;ordinal++) {
    double score=scores[ordinal]; if(score<0) continue;
    if(filled==capacity&&score<=best[filled-1]) continue;
    size_t pos=filled<capacity?filled++:capacity-1;
    while(pos>0&&score>best[pos-1]) {best[pos]=best[pos-1];ids[pos]=ids[pos-1];pos--;}
    best[pos]=score;ids[pos]=ordinal;
  }
  return filled;
}
